import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib import response

from click import prompt
import fitz
import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials as firebase_credentials
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .database import Base, engine, SessionLocal
from . import models


load_dotenv(Path(__file__).parent / ".env")

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

bearer_scheme = HTTPBearer(auto_error=False)


def initialize_firebase_admin():
    if firebase_admin._apps:
        return

    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if credentials_path:
        credential = firebase_credentials.Certificate(credentials_path)
    else:
        project_id = os.getenv("FIREBASE_PROJECT_ID")
        client_email = os.getenv("FIREBASE_CLIENT_EMAIL")
        private_key = os.getenv("FIREBASE_PRIVATE_KEY")

        if not all((project_id, client_email, private_key)):
            raise RuntimeError(
                "Firebase Admin credentials are not configured. Set "
                "GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID, "
                "FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
            )

        credential = firebase_credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "private_key": private_key.replace("\\n", "\n"),
            "client_email": client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
        })

    firebase_admin.initialize_app(credential)


def get_current_user(
    authorization: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if not authorization or authorization.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        initialize_firebase_admin()
        return firebase_auth.verify_id_token(authorization.credentials)
    except Exception as error:
        print(f"Firebase token verification failed: {type(error).__name__}: {error}")
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        )

def parse_gemini_json(text: str):
    cleaned = text.strip()

    # Remove Markdown code fences if Gemini returns them.
    cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^```\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try extracting the first JSON object from the response.
        start = cleaned.find("{")
        end = cleaned.rfind("}")

        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start:end + 1])

        raise


app = FastAPI()

LIVE_MIN_QUESTIONS = 3
LIVE_MAX_QUESTIONS = 5

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


Base.metadata.create_all(bind=engine)


class UserCreate(BaseModel):
    name: str | None = None
    email: str | None = None

class InterviewRequest(BaseModel):
    resume_analysis: dict
    job_description: str
    interview_type: str
    difficulty: str
    number_of_questions: int

class LiveInterviewMessage(BaseModel):
    question: str
    answer: str


class LiveInterviewStartRequest(BaseModel):
    text_questions: list[dict] = Field(default_factory=list)
    text_answers: list[dict] = Field(default_factory=list)
    resume_analysis: dict | None = None
    job_description: str | None = None
    role: str | None = None
    company: str | None = None
    interview_type: str = "Mixed"
    difficulty: str = "Medium"


class LiveInterviewRequest(BaseModel):
    question: str
    answer: str
    history: list[LiveInterviewMessage] = Field(default_factory=list)
    text_questions: list[dict] = Field(default_factory=list)
    text_answers: list[dict] = Field(default_factory=list)
    resume_analysis: dict | None = None
    job_description: str | None = None
    interview_type: str = "Mixed"
    difficulty: str = "Medium" 


class InterviewFinalizeRequest(BaseModel):
    resume_analysis: dict | None = None
    text_questions: list[dict] = Field(default_factory=list)
    text_answers: list[dict] = Field(default_factory=list)
    live_conversation: list[dict] = Field(default_factory=list)
    role: str | None = None
    company: str | None = None
    job_description: str | None = None
    interview_type: str = "Mixed"
    difficulty: str = "Medium"
    previous_interview: dict | None = None

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/")
def home():
    return {"message": "InterviewAI backend is running"}


@app.post("/users")
def create_or_get_user(
    user: UserCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    firebase_uid = current_user["uid"]
    name = current_user.get("name") or user.name or "Unknown"
    email = current_user.get("email") or user.email
    if not email:
        raise HTTPException(status_code=400, detail="Authenticated user has no email.")

    existing_user = (
        db.query(models.User)
        .filter(models.User.firebase_uid == firebase_uid)
        .first()
    )

    if existing_user:
        return {
            "message": "User already exists",
            "user_id": existing_user.id,
            "name": existing_user.name,
            "email": existing_user.email,
        }

    new_user = models.User(
        firebase_uid=firebase_uid,
        name=name,
        email=email,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "User created successfully",
        "user_id": new_user.id,
        "name": new_user.name,
        "email": new_user.email,
    }


@app.post("/upload-resume")
async def upload_resume(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF file"
        )

    pdf_data = await file.read()

    try:
        document = fitz.open(stream=pdf_data, filetype="pdf")

        resume_text = ""

        for page in document:
            resume_text += page.get_text()

        document.close()

        if not resume_text.strip():
            raise HTTPException(
                status_code=400,
                detail="Could not extract text from this PDF"
            )

        prompt = f"""
You are an expert resume analyzer.

Analyze the following resume and return ONLY valid JSON.

Use this exact structure:

{{
    "summary": "brief professional summary",
    "skills": ["skill1", "skill2"],
    "projects": [
        {{
            "name": "project name",
            "description": "brief description",
            "technologies": ["technology1", "technology2"]
        }}
    ],
    "education": [
        {{
            "degree": "degree name",
            "institution": "institution name"
        }}
    ],
    "experience": [
        {{
            "role": "job role",
            "company": "company name",
            "description": "brief description"
        }}
    ]
}}

Resume:

{resume_text}
"""

        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt
        )

        try:
            analysis = parse_gemini_json(response.text)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=502,
                detail="Gemini did not return valid resume JSON"
            )

        return {
            "message": "Resume analyzed successfully",
            "analysis": analysis
        }

    except HTTPException:
        raise

    except Exception as error:
        error_text = str(error)
        if "429" in error_text or "RESOURCE_EXHAUSTED" in error_text:
            raise HTTPException(
                status_code=429,
                detail="Gemini quota has been exceeded. Please try again after the quota resets."
            )
        if "503" in error_text or "UNAVAILABLE" in error_text:
            raise HTTPException(
                status_code=503,
                detail="Gemini is temporarily unavailable. Please try again shortly."
            )
        raise HTTPException(
            status_code=500,
            detail=f"Could not analyze resume: {error_text}"
        )

@app.post("/generate-questions")
def generate_questions(
    request: InterviewRequest,
    current_user: dict = Depends(get_current_user),
):
    prompt = f"""
You are an expert interview question generator for a realistic job interview platform.

Your task is to generate personalized interview questions by analyzing BOTH:
1. The candidate's resume
2. The target job description

The questions must assess how well the candidate's actual skills, projects, education, and experience match the requirements of the target role.

Interview type: {request.interview_type}
Difficulty: {request.difficulty}
Number of questions: {request.number_of_questions}

TARGET JOB DESCRIPTION:
{request.job_description}

CANDIDATE RESUME ANALYSIS:
{json.dumps(request.resume_analysis, indent=2)}

QUESTION GENERATION RULES:

1. Prioritize skills, technologies, responsibilities, and concepts explicitly required by the job description.
2. Use the resume to determine which questions can be personalized to the candidate's actual background.
3. Do not invent experience, projects, skills, or technologies that are not present in the resume.
4. If the job description requires a skill that is missing from the resume, questions may test that skill to evaluate the candidate's readiness, but do not assume the candidate already knows it.
5. Questions should be realistic for the specified interview type and difficulty.
6. Avoid generic questions when a more role-specific question can be created.
7. Maintain a reasonable balance between questions directly based on the job requirements and questions based on the candidate's resume.
8. Each question must have a clear purpose in evaluating the candidate.

Generate exactly {request.number_of_questions} questions.

Return ONLY valid JSON in this exact format:

{{
    "questions": [
        {{
            "question": "The interview question",
            "category": "Technical or HR",
            "difficulty": "{request.difficulty}"
        }}
    ]
}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt
        )

        result = parse_gemini_json(response.text)

        return result

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Gemini did not return valid JSON"
        )

    except Exception as error:
        error_text = str(error)

        if "429" in error_text or "RESOURCE_EXHAUSTED" in error_text:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Gemini quota has been exceeded. "
                    "Please wait for the quota to reset or check your Gemini API plan."
                )
            )

        if "503" in error_text or "UNAVAILABLE" in error_text:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Gemini is temporarily unavailable. "
                    "Please try again shortly."
                )
            )

        raise HTTPException(
            status_code=500,
            detail=f"Could not generate questions: {error_text}"
        )

@app.get("/test-gemini")
def test_gemini():
    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents="Reply with exactly: Gemini is working"
    )

    return {
        "response": response.text
    }

def normalize_question(text: str):
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    stop_words = {
        "what", "is", "are", "the", "a", "an", "of", "to",
        "in", "for", "and", "how", "do", "does", "can",
        "you", "your", "explain", "tell", "me", "about"
    }

    return {
        word
        for word in text.split()
        if word not in stop_words and len(word) > 2
    }


def questions_are_similar(question_one: str, question_two: str):
    words_one = normalize_question(question_one)
    words_two = normalize_question(question_two)

    if not words_one or not words_two:
        return False

    intersection = words_one.intersection(words_two)
    union = words_one.union(words_two)

    similarity = len(intersection) / len(union)

    return similarity >= 0.55

@app.post("/live-interview/start")
def start_live_interview(
    request: LiveInterviewStartRequest,
    current_user: dict = Depends(get_current_user),
):
    text_question_list = [
        item.get("question", "")
        for item in request.text_questions
        if item.get("question")
    ]

    text_context = ""

    for index, item in enumerate(request.text_questions):
        question = item.get("question", "")
        answer = ""

        if index < len(request.text_answers):
            answer = request.text_answers[index].get("answer", "")

        text_context += f"""
Text Interview Question {index + 1}: {question}
Candidate Answer: {answer}
"""

    prompt = f"""
You are an expert AI interviewer starting the LIVE stage of a realistic mock interview.

Role:
{request.role or "Not provided"}

Company:
{request.company or "Not provided"}

Job Description:
{request.job_description or "Not provided"}

Interview type:
{request.interview_type}

Difficulty:
{request.difficulty}

Candidate resume analysis:
{json.dumps(request.resume_analysis or {}, indent=2)}

The candidate has ALREADY completed the following TEXT interview:

{text_context}

You must now begin the LIVE interview.

CRITICAL RULE:
Do NOT repeat, rephrase, or ask a question that tests substantially the same
concept as any question from the text interview.

The live interview must explore NEW areas.

The live interview may:
- explore another requirement from the job description
- test another technical concept
- investigate a resume project more deeply
- test practical understanding
- ask a realistic scenario-based question
- explore a relevant area that was not sufficiently covered in the text interview

Prioritize the job description when available.

Do not evaluate the candidate.
Do not provide feedback.
Ask exactly ONE question.

Return ONLY valid JSON:

{{
    "next_question": "The first live interview question"
}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt
        )

        result = parse_gemini_json(response.text)

        question = result.get("next_question")

        if not question:
            raise HTTPException(
                status_code=500,
                detail="Gemini did not return a live interview question"
            )

        for previous_question in text_question_list:
            if questions_are_similar(question, previous_question):
                retry_prompt = f"""
Generate ONE NEW live interview question.

The candidate has already been asked these questions:

{json.dumps(text_question_list, indent=2)}

The generated question was rejected because it was too similar to a previous
question.

Generate a question that tests a DIFFERENT concept.

Role:
{request.role or "Not provided"}

Job Description:
{request.job_description or "Not provided"}

Difficulty:
{request.difficulty}

Return ONLY valid JSON:

{{
    "next_question": "A completely different question"
}}
"""

                retry_response = client.models.generate_content(
                    model="gemini-3.6-flash",
                    contents=retry_prompt
                )

                result = parse_gemini_json(retry_response.text)
                question = result.get("next_question")

                break

        return {
            "next_question": question
        }

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Gemini returned an invalid response format."
        )

    except HTTPException:
        raise

    except Exception as error:
        error_text = str(error)

        if "429" in error_text or "RESOURCE_EXHAUSTED" in error_text:
            raise HTTPException(
                status_code=429,
                detail="Gemini quota has been exceeded."
            )

        if "503" in error_text or "UNAVAILABLE" in error_text:
            raise HTTPException(
                status_code=503,
                detail="Gemini is temporarily unavailable."
            )

        raise HTTPException(
            status_code=500,
            detail=f"Could not start live interview: {error_text}"
        )

@app.post("/live-interview/respond")
def respond_live_interview(request: LiveInterviewRequest):

    answered_count = len(request.history) + 1

    # Hard maximum: never allow more than 5 questions
    if answered_count >= LIVE_MAX_QUESTIONS:
        return {
            "interview_complete": True,
            "next_question": None
        }

    conversation_text = ""

    for item in request.history:
        conversation_text += (
            f"Interviewer: {item.question}\n"
            f"Candidate: {item.answer}\n\n"
        )

    conversation_text += (
        f"Interviewer: {request.question}\n"
        f"Candidate: {request.answer}\n\n"
    )

    previous_questions = [
    item["question"]
    for item in request.text_questions
]

    for item in request.history:
        previous_questions.append(item.question)

    previous_questions.append(request.question)

    previous_questions_text = "\n".join(
        f"- {q}" for q in previous_questions
    )

    # Q1-Q3 are mandatory
    if answered_count < LIVE_MIN_QUESTIONS:

        prompt = f"""
You are conducting a realistic technical job interview.

Interview type: {request.interview_type}
Difficulty: {request.difficulty}

Job description:
{request.job_description}

Resume analysis:
{request.resume_analysis}

Previous interview conversation:
{conversation_text}

Questions already asked:
{previous_questions_text}

The candidate has answered question {answered_count}.

Generate EXACTLY ONE new interview question.

Rules:
1. Do NOT repeat or substantially rephrase any previous question.
2. Ask about a new relevant concept.
3. Give importance to the job description.
4. Use the resume when relevant.
5. Ask a natural follow-up only if it explores something meaningfully different.
6. Do NOT evaluate the candidate.
7. Return ONLY the question text.
"""

        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt
        )
        question = response.text.strip()

        if any(
            questions_are_similar(question, previous_question)
            for previous_question in previous_questions
        ):
            retry_prompt = prompt + """
The generated question was too similar to an earlier question.
Generate a completely different question covering another concept.
"""

            retry_response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=retry_prompt
            )
            question = retry_response.text.strip()

        return {
            "interview_complete": False,
            "next_question": question
        }

    # Q3/Q4: Gemini decides whether more evidence is required
    prompt = f"""
You are conducting a realistic technical job interview.

Interview type: {request.interview_type}
Difficulty: {request.difficulty}

Job description:
{request.job_description}

Resume analysis:
{request.resume_analysis}

Interview conversation:
{conversation_text}

Questions already asked:
{previous_questions_text}

The candidate has now answered question {answered_count}.

Your task is to decide whether another interview question is necessary.

Continue the interview if:
- The candidate's answer is incomplete or unclear.
- More evidence is needed to judge technical understanding.
- Important job-description skills have not yet been explored.
- The candidate claims something that needs practical verification.
- The interview has not yet gathered enough evidence across different areas.

End the interview if:
- The candidate has demonstrated sufficient understanding.
- Enough different concepts have been assessed.
- Another question would provide little additional useful evidence.

If continuing, generate ONE completely new question.

Do NOT repeat or substantially rephrase previous questions.

Return ONLY valid JSON in exactly this format:

{{
    "continue_interview": true,
    "next_question": "question here"
}}

OR

{{
    "continue_interview": false,
    "next_question": null
}}
"""

    response = client.models.generate_content(
    model="gemini-3.6-flash",
    contents=prompt
    )

    result = parse_gemini_json(response.text)

    continue_interview = result.get("continue_interview", False)
    question = result.get("next_question")

    # Safety: minimum is 3, maximum is 5
    if continue_interview and question:

        if any(
            questions_are_similar(question, previous_question)
            for previous_question in previous_questions
        ):

            retry_prompt = prompt + """
The previous generated question was too similar to an existing question.
Generate a completely different question.
"""

            retry_response = client.models.generate_content(
                                model="gemini-3.6-flash",
                                contents=retry_prompt
                                )
            
            retry_result = parse_gemini_json(retry_response.text)

            question = retry_result.get("next_question")

            if not question or any(
                questions_are_similar(question, previous_question)
                for previous_question in previous_questions
            ):
                return {
                    "interview_complete": True,
                    "next_question": None
                }

        return {
            "interview_complete": False,
            "next_question": question
        }

    return {
        "interview_complete": True,
        "next_question": None
    }


@app.post("/interviews/finalize")
def finalize_interview(
    request: InterviewFinalizeRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    firebase_uid = current_user["uid"]
    user = (
        db.query(models.User)
        .filter(models.User.firebase_uid == firebase_uid)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User profile not found.")

    interview = models.Interview(
        user_id=user.id,
        firebase_uid=firebase_uid,
        role=request.role,
        company=request.company,
        job_description=request.job_description,
        interview_type=request.interview_type,
        difficulty=request.difficulty,
        status="analysis_pending",
        resume_analysis=request.resume_analysis,
        text_questions=request.text_questions,
        text_answers=request.text_answers,
        live_conversation=request.live_conversation,
        created_at=datetime.utcnow(),
    )
    db.add(interview)
    db.commit()
    db.refresh(interview)

    prompt = f"""
You are a senior technical interviewer and AI interview coach.

Your task is to produce a rigorous final assessment of a candidate after analyzing
the COMPLETE mock interview dataset.

This is not a generic motivational report.
Your evaluation must be evidence-based, job-description-aware, and consistent with
the information provided.

IMPORTANT EVALUATION PRINCIPLES:

1. Evaluate the candidate against the JOB DESCRIPTION whenever a job description
   is provided.

2. Prioritize the skills, technologies, responsibilities, concepts, and competencies
   explicitly required by the job description.

3. Use the resume analysis to personalize the evaluation and check whether the
   candidate actually demonstrates knowledge related to the skills they claim.

4. Do NOT invent experience, projects, technologies, responsibilities, achievements,
   or knowledge that are not present in the supplied data.

5. Do not give credit merely because the candidate mentions a keyword.
   A concept should receive positive technical credit only when the candidate
   demonstrates meaningful understanding.

6. Distinguish between:
   - knowing a concept,
   - partially understanding a concept,
   - being unable to explain it,
   - giving an incorrect explanation.

7. Minor spelling, grammar, or typing mistakes should NOT significantly reduce
   technical correctness when the intended meaning is clear.

8. Evaluate the text interview by considering each question together with its
   corresponding answer.

9. Evaluate the live interview as a complete conversation, including consistency,
   follow-up handling, technical depth, communication, and ability to explain ideas.

10. Do not evaluate individual answers in isolation when determining overall
    readiness. Look for patterns across the complete interview.

11. Do not claim that the candidate has demonstrated visual body language,
    eye contact, facial expressions, posture, gestures, or similar visual behavior
    unless actual visual-analysis data is explicitly provided.

12. Confidence may be assessed only from available conversational evidence such as
    clarity, decisiveness, excessive hesitation, hedging, consistency, and ability
    to explain answers. Do not make psychological or medical claims.

13. If a previous interview report is provided, compare the current performance
    with it. Do not invent improvement or decline when there is insufficient evidence.

14. If no previous interview exists, comparison arrays must be empty.

15. Readiness must represent readiness for THIS ROLE, not general intelligence or
    general interview performance.

READINESS SCORING:

Use a score from 0 to 100.

When a Job Description is available, consider approximately:

- 35%: Technical alignment with the job description
- 25%: Quality of text-interview performance
- 25%: Quality of live-interview performance
- 10%: Communication and explanation ability
- 5%: Consistency between resume claims and demonstrated knowledge

These are evaluation guidelines, not mechanical arithmetic.
Use professional judgment based on the evidence.

Readiness status:
- 80-100: "Ready"
- 60-79: "Needs Improvement"
- 0-59: "Not Ready"

A candidate should NOT receive a high readiness score simply because they give
good generic answers if important job-specific requirements are not demonstrated.

If no Job Description is available, evaluate general role readiness using the
resume and interview performance, and explicitly state this limitation.

ROLE:
{request.role or "Not provided"}

COMPANY:
{request.company or "Not provided"}

JOB DESCRIPTION:
{request.job_description or "Not provided"}

INTERVIEW TYPE:
{request.interview_type}

DIFFICULTY:
{request.difficulty}

RESUME ANALYSIS:
{json.dumps(request.resume_analysis or {}, indent=2)}

TEXT INTERVIEW QUESTIONS:
{json.dumps(request.text_questions, indent=2)}

TEXT INTERVIEW ANSWERS:
{json.dumps(request.text_answers, indent=2)}

LIVE INTERVIEW TRANSCRIPT:
{json.dumps(request.live_conversation, indent=2)}

PREVIOUS INTERVIEW REPORT:
{json.dumps(request.previous_interview or {}, indent=2)}

OUTPUT REQUIREMENTS:

Return ONLY valid JSON.

Do not use markdown.
Do not wrap the JSON in ```json.
Do not add explanations outside the JSON.

Return EXACTLY this structure:

{{
  "performance": {{
    "pros": [],
    "cons": [],
    "strengths": [],
    "weaknesses": [],
    "areas_needing_work": []
  }},

  "technical": {{
    "correctness": "",
    "knowledge_gaps": [],
    "concepts_to_focus": [],
    "resume_based_concepts": []
  }},

  "communication": {{
    "clarity": "",
    "structure": "",
    "ability": ""
  }},

  "behaviour": {{
    "confidence": "",
    "interview_behaviour": "",
    "body_language": "Not assessed from available data"
  }},

  "improvement": {{
    "practice_items": [],
    "next_interview_recommendations": []
  }},

  "comparison": {{
    "improved": [],
    "worse": [],
    "previous_weaknesses_improved": [],
    "remaining_weaknesses": []
  }},

  "readiness_score": 0,
  "readiness_status": "Not Ready",
  "readiness_reasoning": ""
}}

FIELD DEFINITIONS:

performance.pros:
List concrete positive observations from the interview.

performance.cons:
List concrete negative observations or performance problems.

performance.strengths:
List the candidate's strongest demonstrated technical, communication, or
problem-solving abilities.

performance.weaknesses:
List concrete weaknesses demonstrated during the interview.

performance.areas_needing_work:
List the most important areas the candidate should improve, prioritized by
importance to the target role.

technical.correctness:
Give a concise overall assessment of the factual and technical correctness
of the candidate's answers. Mention important incorrect or incomplete areas.

technical.knowledge_gaps:
List concepts required or relevant to the role that the candidate failed to
demonstrate adequately.

technical.concepts_to_focus:
List concepts the candidate should study or practice next.

technical.resume_based_concepts:
List concepts or technologies from the supplied resume analysis that were
actually tested or meaningfully demonstrated during the interview.
Do not list every technology appearing in the resume.

communication.clarity:
Assess how clearly the candidate communicated their ideas.

communication.structure:
Assess whether answers were logically organized and easy to follow.

communication.ability:
Assess the candidate's ability to explain technical concepts appropriately,
including to a non-technical listener when relevant.

behaviour.confidence:
Assess confidence only from conversational evidence.

behaviour.interview_behaviour:
Assess behaviors such as listening to questions, staying relevant,
handling follow-ups, consistency, composure, and whether answers appear
prepared versus genuinely understood.

behaviour.body_language:
Because no visual-analysis data is currently supplied, keep this exactly:
"Not assessed from available data"

improvement.practice_items:
Give specific things the candidate should practice based on observed weaknesses.

improvement.next_interview_recommendations:
Give practical recommendations for performing better in the next interview.

comparison.improved:
Only include improvements supported by the previous interview report.

comparison.worse:
Only include areas where the current interview is demonstrably worse than
the previous interview.

comparison.previous_weaknesses_improved:
Identify previous weaknesses that have clearly improved.

comparison.remaining_weaknesses:
Identify weaknesses that remain across interviews.

readiness_reasoning:
Provide a concise evidence-based explanation for the readiness score.
Mention the most important job-specific strengths and gaps influencing the score.
Do not simply repeat the score.

QUALITY CONTROL:

Before returning the JSON, internally verify that:

- The JSON is valid.
- readiness_score is between 0 and 100.
- readiness_status matches the score thresholds.
- No unsupported resume facts were invented.
- No visual body-language claims were invented.
- Job-description requirements were considered when available.
- Technical credit was based on demonstrated understanding rather than keywords.
- Previous-interview improvements were only claimed when evidence exists.
- All required fields are present.
- Arrays contain concise, useful observations rather than vague motivational statements.
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt,
        )
        analysis = parse_gemini_json(response.text)
        readiness_score = max(0, min(100, int(analysis.get("readiness_score", 0))))

        interview.final_analysis = analysis
        interview.readiness_score = readiness_score
        interview.readiness_status = analysis.get("readiness_status", "Not Ready")
        interview.status = "completed"
        interview.completed_at = datetime.utcnow()
        db.commit()
        db.refresh(interview)

        return {
            "interview_id": interview.id,
            "status": interview.status,
            "analysis": analysis,
            "readiness_score": readiness_score,
            "readiness_status": interview.readiness_status,
        }

    except json.JSONDecodeError:
        interview.status = "analysis_failed"
        db.commit()
        raise HTTPException(
            status_code=502,
            detail={
                "message": "The interview was saved, but Gemini returned an invalid report format.",
                "interview_id": interview.id,
            },
        )

    except Exception as error:
        error_text = str(error)
        interview.status = "analysis_pending"
        db.commit()

        if "429" in error_text or "RESOURCE_EXHAUSTED" in error_text:
            raise HTTPException(
                status_code=429,
                detail={
                    "message": "The interview was saved, but Gemini quota has been exceeded.",
                    "interview_id": interview.id,
                },
            )

        if "503" in error_text or "UNAVAILABLE" in error_text:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "The interview was saved, but Gemini is temporarily unavailable.",
                    "interview_id": interview.id,
                },
            )

        raise HTTPException(
            status_code=500,
            detail={
                "message": "The interview was saved, but final analysis failed.",
                "interview_id": interview.id,
            },
        )


@app.get("/interviews/user/{firebase_uid}")
def list_interviews(
    firebase_uid: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if firebase_uid != current_user["uid"]:
        raise HTTPException(status_code=403, detail="Access to this user's interviews is forbidden.")

    interviews = (
        db.query(models.Interview)
        .filter(models.Interview.firebase_uid == firebase_uid)
        .order_by(models.Interview.created_at.desc())
        .all()
    )

    return {
        "interviews": [
            {
                "id": interview.id,
                "created_at": interview.created_at.isoformat(),
                "role": interview.role,
                "company": interview.company,
                "status": interview.status,
                "readiness_score": interview.readiness_score,
                "readiness_status": interview.readiness_status,
                "analysis": interview.final_analysis,
            }
            for interview in interviews
        ]
    }