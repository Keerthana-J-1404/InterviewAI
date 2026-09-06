from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    firebase_uid = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)


class Interview(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    firebase_uid = Column(String, nullable=True, index=True)
    role = Column(String, nullable=True)
    company = Column(String, nullable=True)
    job_description = Column(String, nullable=True)
    interview_type = Column(String, nullable=False)
    difficulty = Column(String, nullable=False)
    status = Column(String, nullable=False, default="completed")
    resume_analysis = Column(JSON, nullable=True)
    text_questions = Column(JSON, nullable=False, default=list)
    text_answers = Column(JSON, nullable=False, default=list)
    live_conversation = Column(JSON, nullable=False, default=list)
    final_analysis = Column(JSON, nullable=True)
    readiness_score = Column(Integer, nullable=True)
    readiness_status = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    