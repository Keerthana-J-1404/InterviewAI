import json
import os
import re
from datetime import datetime
from pathlib import Path

import fitz
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import Base, engine, SessionLocal
from . import models


load_dotenv(Path(__file__).parent / ".env")

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


Base.metadata.create_all(bind=engine)


class UserCreate(BaseModel):
    firebase_uid: str
    name: str
    email: str

class InterviewRequest(BaseModel):
    resume_analysis: dict
    interview_type: str
    difficulty: str
    number_of_questions: int

class LiveInterviewMessage(BaseModel):
    question: str
    answer: str


class LiveInterviewRequest(BaseModel):
    question: str
    answer: str
    history: list[LiveInterviewMessage] = Field(default_factory=list)
    interview_type: str = "Mixed"
    difficulty: str = "Medium"


class InterviewFinalizeRequest(BaseModel):
    firebase_uid: str | None = None
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
def create_or_get_user(user: UserCreate, db: Session = Depends(get_db)):
    existing_user = (
        db.query(models.User)
        .filter(models.User.firebase_uid == user.firebase_uid)
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
        firebase_uid=user.firebase_uid,
        name=user.name,
        email=user.email,
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
async def upload_resume(file: UploadFile = File(...)):
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
def generate_questions(request: InterviewRequest):
    prompt = f"""
You are an expert interview question generator.

Create personalized interview questions based on the candidate's resume analysis.

Interview type: {request.interview_type}
Difficulty: {request.difficulty}
Number of questions: {request.number_of_questions}

Candidate resume analysis:

{json.dumps(request.resume_analysis, indent=2)}

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

@app.post("/live-interview/respond")
def live_interview_respond(request: LiveInterviewRequest):
    conversation_history = ""

    for index, item in enumerate(request.history, start=1):
        conversation_history += f"""
Question {index}: {item.question}
Candidate Answer: {item.answer}
"""

    conversation_history += f"""
Question {len(request.history) + 1}: {request.question}
Candidate Answer: {request.answer}
"""

    prompt = f"""
You are an expert AI interviewer conducting a realistic mock interview.

Interview type: {request.interview_type}
Difficulty: {request.difficulty}

Here is the interview conversation so far:

{conversation_history}

Based on the entire conversation, generate the next appropriate interview question.

Rules:
- Remember what the candidate has already said.
- Do not repeat questions that have already been asked.
- Ask a natural follow-up when the candidate's answer gives you something worth exploring.
- If the answer is sufficient, move to a relevant new topic.
- Keep the question appropriate for the interview type.
- Match the requested difficulty.
- Do not evaluate the candidate.
- Do not provide feedback.
- Return ONLY valid JSON.

Return exactly:

{{
    "next_question": "The next interview question"
}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt
        )

        result = parse_gemini_json(response.text)

        if "next_question" not in result:
            raise HTTPException(
                status_code=500,
                detail="Gemini did not return a next question"
            )

        return result

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
            detail=f"Could not generate next question: {error_text}"
        )


@app.post("/interviews/finalize")
def finalize_interview(
    request: InterviewFinalizeRequest,
    db: Session = Depends(get_db),
):
    user = None
    if request.firebase_uid:
        user = (
            db.query(models.User)
            .filter(models.User.firebase_uid == request.firebase_uid)
            .first()
        )

    interview = models.Interview(
        user_id=user.id if user else None,
        firebase_uid=request.firebase_uid,
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
You are a senior interview coach producing the final report for a realistic mock interview.
Do not evaluate individual answers in isolation. Analyze the complete interview dataset together.

Role: {request.role or "Not provided"}
Company: {request.company or "Not provided"}
Job description: {request.job_description or "Not provided"}
Interview type: {request.interview_type}
Difficulty: {request.difficulty}

Resume analysis:
{json.dumps(request.resume_analysis or {}, indent=2)}

Text interview questions:
{json.dumps(request.text_questions, indent=2)}

Text interview answers:
{json.dumps(request.text_answers, indent=2)}

Live interview transcript and answers:
{json.dumps(request.live_conversation, indent=2)}

Previous interview report, if available:
{json.dumps(request.previous_interview or {}, indent=2)}

Return ONLY valid JSON in this exact shape:
{{
  "performance": {{
    "pros": [], "cons": [], "strengths": [], "weaknesses": [], "areas_needing_work": []
  }},
  "technical": {{
    "correctness": "", "knowledge_gaps": [], "concepts_to_focus": [], "resume_based_concepts": []
  }},
  "communication": {{"clarity": "", "structure": "", "ability": ""}},
  "behaviour": {{"confidence": "", "interview_behaviour": "", "body_language": "Not assessed from available data"}},
  "improvement": {{"practice_items": [], "next_interview_recommendations": []}},
  "comparison": {{"improved": [], "worse": [], "previous_weaknesses_improved": [], "remaining_weaknesses": []}},
  "readiness_score": 0,
  "readiness_status": "Not Ready",
  "readiness_reasoning": ""
}}

Use a readiness score from 0 to 100. If no role, company, or job description is provided,
base readiness on the resume and interview performance and say so in readiness_reasoning.
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
def list_interviews(firebase_uid: str, db: Session = Depends(get_db)):
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