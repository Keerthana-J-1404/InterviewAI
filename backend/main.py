from fastapi import FastAPI
from .database import Base, engine
from . import models

app = FastAPI()
Base.metadata.create_all(bind=engine)

@app.get("/")
def home():
    return{"message":"InterviewAI backend is running"} 