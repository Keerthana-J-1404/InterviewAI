import json
import os
from pathlib import Path

import fitz
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import Base, engine, SessionLocal
from . import models


load_dotenv(Path(__file__).parent / ".env")

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

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

class LiveInterviewRequest(BaseModel):
    question: str
    answer: str
    interview_type: str = "Mixed"
    difficulty: str = "Medium"

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
            analysis = json.loads(response.text)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=500,
                detail="Gemini did not return valid JSON"
            )

        return {
            "message": "Resume analyzed successfully",
            "analysis": analysis
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Could not analyze resume: {str(error)}"
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

        result = json.loads(response.text)

        return result

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Gemini did not return valid JSON"
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Could not generate questions: {str(error)}"
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
    prompt = f"""
You are an expert AI interviewer conducting a realistic mock interview.

The candidate was asked this question:

{request.question}

The candidate answered:

{request.answer}

Interview type: {request.interview_type}
Difficulty: {request.difficulty}

Based on the candidate's answer, generate the next appropriate interview question.

Rules:
- Continue the interview naturally.
- If the answer is interesting or incomplete, ask a relevant follow-up question.
- If the answer is sufficient, move to a related topic.
- Keep the question relevant to the interview type.
- Match the requested difficulty.
- Do not evaluate or criticize the candidate.
- Do not provide feedback.
- Return ONLY valid JSON.

Return exactly this format:

{{
    "next_question": "The next interview question"
}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt
        )

        result = json.loads(response.text)

        if "next_question" not in result:
            raise HTTPException(
                status_code=500,
                detail="Gemini did not return a next question"
            )

        return result

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Gemini did not return valid JSON"
        )

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Could not generate next question: {str(error)}"
        )