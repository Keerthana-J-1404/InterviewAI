import { GoogleAuthProvider, signInWithPopup } from "firebase/auth"
import { auth } from "./firebase"
import { useEffect, useRef, useState } from "react"
import "./App.css"

function App() {
  const [user, setUser] = useState(null)
  const [resumeAnalysis, setResumeAnalysis] = useState(null)
  const [questions, setQuestions] = useState([])

  const [interviewType, setInterviewType] = useState("Technical")
  const [difficulty, setDifficulty] = useState("Medium")
  const [numberOfQuestions, setNumberOfQuestions] = useState(5)
  const [role, setRole] = useState("")
  const [company, setCompany] = useState("")
  const [jobDescription, setJobDescription] = useState("")

  const [liveInterviewStarted, setLiveInterviewStarted] = useState(false)
  const [cameraStream, setCameraStream] = useState(null)
  const [cameraError, setCameraError] = useState("")

  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false)
  const [liveConversation, setLiveConversation] = useState([])
  const [liveCurrentQuestion, setLiveCurrentQuestion] = useState(null)
  const [liveInterviewError, setLiveInterviewError] = useState("")
  const [isFinalizingInterview, setIsFinalizingInterview] = useState(false)
  const [finalAnalysis, setFinalAnalysis] = useState(null)
  const [interviewHistory, setInterviewHistory] = useState([])

  const recognitionRef = useRef(null)
  const videoRef = useRef(null)

  // Text interview state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [currentAnswer, setCurrentAnswer] = useState("")
  const [answers, setAnswers] = useState([])
  const [textInterviewStarted, setTextInterviewStarted] = useState(false)
  const [textInterviewCompleted, setTextInterviewCompleted] = useState(false)

  const loadInterviewHistory = async (firebaseUid) => {
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/interviews/user/${firebaseUid}`
      )
      if (!response.ok) return
      const data = await response.json()
      setInterviewHistory(data.interviews || [])
    } catch (error) {
      console.error("Interview history failed to load:", error)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)

      const loggedInUser = result.user

      setUser(loggedInUser)

      console.log("Logged in user:", loggedInUser)

      const response = await fetch("http://127.0.0.1:8000/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firebase_uid: loggedInUser.uid,
          name: loggedInUser.displayName || "Unknown",
          email: loggedInUser.email,
        }),
      })

      const data = await response.json()

      console.log("Backend response:", data)
      await loadInterviewHistory(loggedInUser.uid)
    } catch (error) {
      console.error("Login failed:", error)
    }
  }

  const handleResumeUpload = async (event) => {
    const file = event.target.files[0]

    if (!file) return

    if (file.type !== "application/pdf") {
      console.error("Please select a PDF file")
      return
    }

    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/upload-resume",
        {
          method: "POST",
          body: formData,
        }
      )

      const data = await response.json()

      console.log("Resume response:", data)

      setResumeAnalysis(data.analysis)
    } catch (error) {
      console.error("Resume upload failed:", error)
    }
  }

  const handleGenerateQuestions = async () => {
    if (!resumeAnalysis) {
      console.error("Please upload a resume first")
      return
    }

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/generate-questions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resume_analysis: resumeAnalysis,
            interview_type: interviewType,
            difficulty: difficulty,
            number_of_questions: Number(numberOfQuestions),
          }),
        }
      )

      const data = await response.json()

      console.log("Generated questions:", data)

      if (!response.ok) {
        console.error("Question generation failed:", data.detail)
        return
      }

      if (!data.questions || !Array.isArray(data.questions)) {
        console.error("Invalid question response:", data)
        return
      }

      setQuestions(data.questions)

      // Reset text interview
      setCurrentQuestionIndex(0)
      setCurrentAnswer("")
      setAnswers([])
      setTextInterviewStarted(true)
      setTextInterviewCompleted(false)

    } catch (error) {
      console.error("Question generation failed:", error)
    }
  }

  const handleSubmitAnswer = () => {
    if (!currentAnswer.trim()) {
      console.error("Please enter an answer")
      return
    }

    const currentQuestion = questions[currentQuestionIndex]

    const newAnswer = {
      question: currentQuestion.question,
      answer: currentAnswer,
      category: currentQuestion.category,
      difficulty: currentQuestion.difficulty,
    }

    const updatedAnswers = [...answers, newAnswer]

    setAnswers(updatedAnswers)
    setCurrentAnswer("")

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
    } else {
      setTextInterviewCompleted(true)
      setTextInterviewStarted(false)

      console.log("Text interview completed!")
      console.log("Text interview answers:", updatedAnswers)
    }
  }


  const startLiveInterview = async () => {
  try {
    setCameraError("")

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    })

    setCameraStream(stream)
    setLiveInterviewStarted(true)

    setLiveConversation([])
    setCurrentQuestionIndex(0)
    setTranscript("")
    setIsListening(false)
    setLiveCurrentQuestion(questions[0] || null)
    setLiveInterviewError("")

    console.log("Camera and microphone access granted")
  } 
  catch (error) {
    console.error("Camera/microphone access failed:", error)
    setCameraError(
      "Camera and microphone access is required for the live interview."
    )
  }
}

  const speakQuestion = (questionText) => {
    if (!("speechSynthesis" in window)) {
      console.error("Speech synthesis is not supported in this browser.")
      return
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(questionText)

    utterance.rate = 0.95
    utterance.pitch = 1
    utterance.volume = 1

    window.speechSynthesis.speak(utterance)
  }

  const startListening = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      console.error("Speech recognition is not supported in this browser.")
      return
    }

    const recognition = new SpeechRecognition()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-IN"

    recognition.onstart = () => {
      setIsListening(true)
      console.log("Speech recognition started")
    }

    recognition.onresult = (event) => {
      let spokenText = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        spokenText += event.results[i][0].transcript
      }

      setTranscript(spokenText)
    }

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
      console.log("Speech recognition ended")
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }

    setIsListening(false)
  }

  const submitLiveAnswer = async () => {
  if (!transcript.trim() || !liveCurrentQuestion || isProcessingAnswer) {
    return
  }

  const candidateAnswer = transcript.trim()

  setIsProcessingAnswer(true)
  setLiveInterviewError("")

  try {
    const response = await fetch(
      "http://127.0.0.1:8000/live-interview/respond",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: liveCurrentQuestion.question,
          answer: candidateAnswer,
          history: liveConversation,
          interview_type: interviewType,
          difficulty: liveCurrentQuestion.difficulty || difficulty,
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.detail || "Failed to generate next question"
      )
    }

    const updatedConversation = [
      ...liveConversation,
      {
        question: liveCurrentQuestion.question,
        answer: candidateAnswer,
      },
    ]

    setLiveConversation(updatedConversation)

    console.log("Conversation history:", updatedConversation)
    console.log("Next question:", data.next_question)

    setQuestions((previousQuestions) => [
      ...previousQuestions,
      {
        question: data.next_question,
        category: "Follow-up",
        difficulty: liveCurrentQuestion.difficulty || difficulty,
      },
    ])

    setLiveCurrentQuestion({
      question: data.next_question,
      category: "Follow-up",
      difficulty: liveCurrentQuestion.difficulty || difficulty,
    })

    setCurrentQuestionIndex(
      (previousIndex) => previousIndex + 1
    )

    setTranscript("")

  } catch (error) {
    console.error("Live interview error:", error)
    setLiveInterviewError(error.message)
  } finally {
    setIsProcessingAnswer(false)
  }
}

  const finalizeInterview = async () => {
    if (isFinalizingInterview) return

    stopListening()
    window.speechSynthesis?.cancel()
    setIsFinalizingInterview(true)
    setLiveInterviewError("")

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/interviews/finalize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firebase_uid: user?.uid || null,
            resume_analysis: resumeAnalysis,
            text_questions: questions.slice(0, Number(numberOfQuestions)),
            text_answers: answers,
            live_conversation: liveConversation,
            role: role.trim() || null,
            company: company.trim() || null,
            job_description: jobDescription.trim() || null,
            interview_type: interviewType,
            difficulty,
            previous_interview: interviewHistory[0]?.analysis || null,
          }),
        }
      )
      const data = await response.json()

      if (!response.ok) {
        const detail = data.detail
        throw new Error(
          typeof detail === "string" ? detail : detail?.message || "Final analysis failed"
        )
      }

      setFinalAnalysis(data)
      setLiveInterviewStarted(false)
      await loadInterviewHistory(user?.uid)
    } catch (error) {
      console.error("Interview finalization failed:", error)
      setLiveInterviewError(error.message)
    } finally {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop())
      }
      setCameraStream(null)
      setIsFinalizingInterview(false)
    }
  }

  useEffect(() => {
    if (liveInterviewStarted && liveCurrentQuestion?.question) {
      speakQuestion(liveCurrentQuestion.question)
    }
  }, [liveInterviewStarted, liveCurrentQuestion])

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream
    }
  }, [cameraStream, liveInterviewStarted])

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [cameraStream])



  return (
    <main>
      <h1>InterviewAI</h1>

      {/* SIGN IN */}

      <section>
        <h2>1. Sign in</h2>

        {user ? (
          <p>Signed in as {user.email}</p>
        ) : (
          <button onClick={handleGoogleLogin}>
            Sign in with Google
          </button>
        )}
      </section>

      {/* RESUME */}

      <section>
        <h2>2. Upload Resume</h2>

        <input
          type="file"
          accept="application/pdf"
          onChange={handleResumeUpload}
        />

        {resumeAnalysis && (
          <p>Resume analyzed successfully!</p>
        )}
      </section>

      {/* INTERVIEW SETTINGS */}

      <section>
        <h2>3. Interview Settings</h2>

        <div>
          <label>Interview Type: </label>

          <select
            value={interviewType}
            onChange={(event) =>
              setInterviewType(event.target.value)
            }
          >
            <option>Technical</option>
            <option>HR</option>
            <option>Mixed</option>
          </select>
        </div>

        <br />

        <div>
          <label>Difficulty: </label>

          <select
            value={difficulty}
            onChange={(event) =>
              setDifficulty(event.target.value)
            }
          >
            <option>Easy</option>
            <option>Medium</option>
            <option>Hard</option>
          </select>
        </div>

        <br />

        <div>
          <label>Number of Questions: </label>

          <select
            value={numberOfQuestions}
            onChange={(event) =>
              setNumberOfQuestions(event.target.value)
            }
          >
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
          </select>
        </div>

        <br />

        <div className="optional-context">
          <label>
            Role (optional)
            <input value={role} onChange={(event) => setRole(event.target.value)} />
          </label>
          <label>
            Company (optional)
            <input value={company} onChange={(event) => setCompany(event.target.value)} />
          </label>
          <label>
            Job description (optional)
            <textarea
              rows="4"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
            />
          </label>
        </div>

        <br />

        <button onClick={handleGenerateQuestions}>
          Start Text Interview
        </button>
      </section>

      {/* TEXT INTERVIEW */}

      {textInterviewStarted && questions.length > 0 && (
        <section>
          <h2>4. Text Interview</h2>

          <p>
            Question {currentQuestionIndex + 1} of{" "}
            {questions.length}
          </p>

          <h3>
            {questions[currentQuestionIndex].question}
          </h3>

          <p>
            Category:{" "}
            {questions[currentQuestionIndex].category}
          </p>

          <textarea
            rows="8"
            cols="60"
            placeholder="Type your answer here..."
            value={currentAnswer}
            onChange={(event) =>
              setCurrentAnswer(event.target.value)
            }
          />

          <br />
          <br />

          <button onClick={handleSubmitAnswer}>
            {currentQuestionIndex === questions.length - 1
              ? "Finish Text Interview"
              : "Submit Answer"}
          </button>
        </section>
      )}

      {/* COMPLETED */}

      {textInterviewCompleted && (
        <section>
          <h2>Text Interview Completed ✅</h2>

          <p>
            You answered all {answers.length} questions.
          </p>

          <p>
            Next stage: Live AI Video Interview
          </p>

          <button onClick={startLiveInterview}>
            Continue to Live Interview
          </button>
        </section>
      )}

      {liveInterviewStarted && (
          <section className="live-interview">
            <div className="live-interview-header">
              <h2>Live AI Interview</h2>
              <p>Your interview has started</p>
            </div>

            <div className="interview-stage">

              {/* AI INTERVIEWER */}
              <div className="interviewer-panel">
                <div className="ai-avatar">
                  🤖
                </div>

                <h3>AI Interviewer</h3>

                <p className="ai-status">
                  Listening and preparing your first question...
                </p>

                {liveCurrentQuestion && (
                  <div className="current-question">
                    <strong>
                      Question {liveConversation.length + 1}
                    </strong>

                    <p>
                      {liveCurrentQuestion.question}
                    </p>
                  </div>
                )}

                <div className="speech-controls">
                  {!isListening ? (
                    <button
                      onClick={startListening}
                      disabled={isProcessingAnswer}
                    >
                      🎤 Start Answer
                    </button>
                  ) : (
                    <button onClick={stopListening}>
                      ⏹ Stop Listening
                    </button>
                  )}

                  {transcript && !isListening && (
                    <button
                      onClick={submitLiveAnswer}
                      disabled={isProcessingAnswer}
                    >
                      {isProcessingAnswer
                        ? "🤖 Thinking..."
                        : "➡️ Submit Answer"}
                    </button>
                  )}
                </div>

                {transcript && (
                  <div className="transcript-box">
                    <strong>Your Answer</strong>
                    <p>{transcript}</p>
                  </div>
                )}

                {liveInterviewError && (
                  <p role="alert" className="live-interview-error">
                    {liveInterviewError}
                  </p>
                )}
              </div>


              {/* APPLICANT CAMERA */}
              <div className="camera-panel">
              <h3>Your Camera</h3>

              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
              />

              <div className="media-status">
                <span>🎤 Microphone: Active</span>
                <span>📹 Camera: Active</span>
              </div>
            </div>

          </div>

          <button
            className="end-interview-button"
            onClick={finalizeInterview}
            disabled={isFinalizingInterview || isProcessingAnswer}
          >
          {isFinalizingInterview ? "Preparing final report..." : "End Interview"}
          </button>
        </section>
      )}

      {finalAnalysis && (
        <section className="final-report">
          <h2>Interview Report</h2>
          <p className="readiness-score">
            {finalAnalysis.readiness_score}% · {finalAnalysis.readiness_status}
          </p>
          <ReportGroup title="Strengths" items={finalAnalysis.analysis?.performance?.strengths} />
          <ReportGroup title="Areas needing work" items={finalAnalysis.analysis?.performance?.areas_needing_work} />
          <ReportGroup title="Practice next" items={finalAnalysis.analysis?.improvement?.practice_items} />
          <p>{finalAnalysis.analysis?.readiness_reasoning}</p>
        </section>
      )}

      {interviewHistory.length > 0 && (
        <section className="interview-history">
          <h2>Interview History</h2>
          {interviewHistory.map((interview) => (
            <article key={interview.id} className="history-entry">
              <strong>
                {interview.role || "General preparation"}
                {interview.company ? ` · ${interview.company}` : ""}
              </strong>
              <span>
                {new Date(interview.created_at).toLocaleDateString()} · {interview.readiness_score ?? "--"}% · {interview.readiness_status || interview.status}
              </span>
            </article>
          ))}
        </section>
      )}

{cameraError && (
  <section>
    <p>{cameraError}</p>
  </section>
)}
    </main>
  )
}

function ReportGroup({ title, items }) {
  if (!items?.length) return null

  return (
    <div className="report-group">
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  )
}

export default App