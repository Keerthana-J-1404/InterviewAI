import { GoogleAuthProvider, signInWithPopup } from "firebase/auth"
import { auth } from "./firebase"
import { useEffect, useRef, useState } from "react"
import "./App.css"

const authenticatedFetch = async (url, options = {}) => {
  const currentUser = auth.currentUser
  if (!currentUser) {
    throw new Error("Please sign in before using InterviewAI.")
  }

  const token = await currentUser.getIdToken()
  const headers = new Headers(options.headers || {})
  headers.set("Authorization", `Bearer ${token}`)

  return fetch(url, { ...options, headers })
}

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
  const transcriptRef = useRef("")
  const shouldContinueRecognitionRef = useRef(false)
  const recognitionRestartTimeoutRef = useRef(null)
  const answerSubmissionRef = useRef(false)
  const videoRef = useRef(null)

  // Text interview state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [currentAnswer, setCurrentAnswer] = useState("")
  const [answers, setAnswers] = useState([])
  const [textInterviewStarted, setTextInterviewStarted] = useState(false)
  const [textInterviewCompleted, setTextInterviewCompleted] = useState(false)

  const loadInterviewHistory = async (firebaseUid) => {
    try {
      const response = await authenticatedFetch(
        `http://localhost:8000/interviews/user/${firebaseUid}`
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

      const response = await authenticatedFetch("http://localhost:8000/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
      const response = await authenticatedFetch(
        "http://localhost:8000/upload-resume",
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
      const response = await authenticatedFetch(
        "http://localhost:8000/generate-questions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resume_analysis: resumeAnalysis,
            job_description: jobDescription,
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
    transcriptRef.current = ""
    setTranscript("")
    setIsListening(false)
    setLiveCurrentQuestion(null)
    setLiveInterviewError("")
    setIsProcessingAnswer(true)

    console.log("Camera and microphone access granted")

    const response = await authenticatedFetch(
      "http://localhost:8000/live-interview/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text_questions: questions.slice(0, Number(numberOfQuestions)),
          text_answers: answers,
          resume_analysis: resumeAnalysis,
          job_description: jobDescription.trim() || null,
          role: role.trim() || null,
          company: company.trim() || null,
          interview_type: interviewType,
          difficulty,
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.detail || "Failed to start live interview"
      )
    }

    if (!data.next_question) {
      throw new Error("No live interview question was returned.")
    }

    const firstLiveQuestion = {
      question: data.next_question,
      category: "Live Interview",
      difficulty,
    }

    setLiveCurrentQuestion(firstLiveQuestion)

    console.log("First live question:", data.next_question)

  } catch (error) {
    console.error("Live interview start failed:", error)
    setLiveInterviewError(error.message)

    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop())
    }

    setCameraStream(null)
    setLiveInterviewStarted(false)
  } finally {
    setIsProcessingAnswer(false)
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
    if (recognitionRef.current || recognitionRestartTimeoutRef.current) {
      return
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setLiveInterviewError("Speech recognition is not supported in this browser.")
      return
    }

    const recognition = new SpeechRecognition()
    const sessionBaseTranscript = transcriptRef.current.trim()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-IN"

    recognition.onstart = () => {
      if (recognitionRef.current === recognition) {
        setIsListening(true)
        console.log("Speech recognition started")
      }
    }

    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return

      const spokenText = Array.from(event.results)
        .map((result) => result[0]?.transcript.trim())
        .filter(Boolean)
        .join(" ")
      const nextTranscript = [sessionBaseTranscript, spokenText]
        .filter(Boolean)
        .join(" ")

      transcriptRef.current = nextTranscript
      setTranscript(nextTranscript)
    }

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error)
      if (event.error !== "no-speech") {
        shouldContinueRecognitionRef.current = false
        setIsListening(false)
      }
    }

    recognition.onend = () => {
      console.log("Speech recognition ended")

      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null

      if (!shouldContinueRecognitionRef.current) {
        setIsListening(false)
        return
      }

      recognitionRestartTimeoutRef.current = window.setTimeout(() => {
        recognitionRestartTimeoutRef.current = null
        if (shouldContinueRecognitionRef.current) {
          startListening()
        }
      }, 250)
    }

    recognitionRef.current = recognition
    shouldContinueRecognitionRef.current = true

    try {
      recognition.start()
    } catch (error) {
      recognitionRef.current = null
      shouldContinueRecognitionRef.current = false
      setIsListening(false)
      console.error("Could not start speech recognition:", error)
    }
  }

  const stopListening = () => {
    shouldContinueRecognitionRef.current = false

    if (recognitionRestartTimeoutRef.current) {
      window.clearTimeout(recognitionRestartTimeoutRef.current)
      recognitionRestartTimeoutRef.current = null
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (error) {
        recognitionRef.current = null
        setIsListening(false)
        console.error("Could not stop speech recognition:", error)
      }
    } else {
      setIsListening(false)
    }
  }

  const submitLiveAnswer = async () => {
  const candidateAnswer = transcriptRef.current.trim()

  if (
    answerSubmissionRef.current ||
    !candidateAnswer ||
    !liveCurrentQuestion ||
    isProcessingAnswer
  ) {
    return
  }

  answerSubmissionRef.current = true
  stopListening()

  setIsProcessingAnswer(true)
  setLiveInterviewError("")

  try {
    const response = await authenticatedFetch(
      "http://localhost:8000/live-interview/respond",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: liveCurrentQuestion.question,
          answer: candidateAnswer,
          history: liveConversation,
          text_questions: questions.slice(0, Number(numberOfQuestions)),
          text_answers: answers,
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

    if (data.interview_complete) {
      await finalizeInterview(updatedConversation)
      return
    }

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

    transcriptRef.current = ""
    setTranscript("")

  } catch (error) {
    console.error("Live interview error:", error)
    setLiveInterviewError(error.message)
  } finally {
    answerSubmissionRef.current = false
    setIsProcessingAnswer(false)
  }
}

  const finalizeInterview = async (conversationToFinalize = liveConversation) => {
    if (isFinalizingInterview) return

    stopListening()
    window.speechSynthesis?.cancel()
    setIsFinalizingInterview(true)
    setLiveInterviewError("")

    try {
      const response = await authenticatedFetch(
        "http://localhost:8000/interviews/finalize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume_analysis: resumeAnalysis,
            text_questions: questions.slice(0, Number(numberOfQuestions)),
            text_answers: answers,
            live_conversation: conversationToFinalize,
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
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="InterviewAI dashboard">
          <span className="brand-mark" aria-hidden="true">I</span>
          <span>Interview<span className="brand-accent">AI</span></span>
        </a>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#dashboard">
            <span aria-hidden="true">⌂</span> Dashboard
          </a>
          <a className="nav-link" href="#resume">
            <span aria-hidden="true">▤</span> Resume
          </a>
          <a className="nav-link" href="#settings">
            <span aria-hidden="true">✦</span> Interview setup
          </a>
          {interviewHistory.length > 0 && (
            <a className="nav-link" href="#history">
              <span aria-hidden="true">◷</span> Interview history
            </a>
          )}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon" aria-hidden="true">✦</span>
          <p>Build confidence, one interview at a time.</p>
        </div>
      </aside>

      <main className="app-main" id="dashboard">
        <header className="page-header">
          <div className="welcome-copy">
            <p className="eyebrow">YOUR PREPARATION SPACE</p>
            <h1>{user?.displayName ? `Welcome back, ${user.displayName.split(" ")[0]}` : "Prepare for your next opportunity"}</h1>
            <p>Practice with purpose and feel ready for what comes next.</p>
          </div>
          <div className="account-summary">
            <span className="account-avatar" aria-hidden="true">
              {user?.displayName?.charAt(0) || user?.email?.charAt(0) || "G"}
            </span>
            <span className="account-copy">
              <strong>{user?.displayName || (user ? "Signed in" : "Guest")}</strong>
              <span>{user?.email || "Sign in to get started"}</span>
            </span>
          </div>
        </header>

        <div className="dashboard-grid">
          <div className="dashboard-primary">
            <section className="dashboard-card" id="settings" aria-labelledby="settings-title">
              <div className="card-heading">
                <span className="step-marker">02</span>
                <div>
                  <p className="eyebrow">MAKE IT YOURS</p>
                  <h2 id="settings-title">Configure your interview</h2>
                </div>
              </div>
              <p className="card-description">Tailor a practice session to the role you have in mind.</p>

              <div className="settings-grid">
                <label className="form-field" htmlFor="interview-type">
                  <span>Interview type</span>
                  <select
                    id="interview-type"
                    value={interviewType}
                    onChange={(event) => setInterviewType(event.target.value)}
                  >
                    <option>Technical</option>
                    <option>HR</option>
                    <option>Mixed</option>
                  </select>
                </label>
                <label className="form-field" htmlFor="interview-difficulty">
                  <span>Difficulty</span>
                  <select
                    id="interview-difficulty"
                    value={difficulty}
                    onChange={(event) => setDifficulty(event.target.value)}
                  >
                    <option>Easy</option>
                    <option>Medium</option>
                    <option>Hard</option>
                  </select>
                </label>
                <label className="form-field" htmlFor="question-count">
                  <span>Number of questions</span>
                  <select
                    id="question-count"
                    value={numberOfQuestions}
                    onChange={(event) => setNumberOfQuestions(event.target.value)}
                  >
                    <option value="3">3 questions</option>
                    <option value="5">5 questions</option>
                    <option value="10">10 questions</option>
                  </select>
                </label>
                <label className="form-field" htmlFor="role-input">
                  <span>Role <small>Optional</small></span>
                  <input id="role-input" value={role} onChange={(event) => setRole(event.target.value)} placeholder="e.g. Product designer" />
                </label>
                <label className="form-field" htmlFor="company-input">
                  <span>Company <small>Optional</small></span>
                  <input id="company-input" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="e.g. Acme Inc." />
                </label>
              </div>
              <label className="form-field job-description-field" htmlFor="job-description">
                <span>Job description <small>Optional</small></span>
                <textarea
                  id="job-description"
                  rows="4"
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  placeholder="Paste the role description to personalize your interview..."
                />
              </label>
              <div className="primary-action-row">
                <button className="button button-primary" onClick={handleGenerateQuestions}>
                  Generate interview questions
                  <span aria-hidden="true">→</span>
                </button>
                {!resumeAnalysis && <span className="action-hint">Upload a resume to get started</span>}
              </div>
            </section>
          </div>

          <aside className="dashboard-secondary" aria-label="Resume, account, and recent activity">
            <section className="dashboard-card resume-card" id="resume" aria-labelledby="resume-title">
              <div className="card-heading">
                <span className="step-marker">01</span>
                <div>
                  <p className="eyebrow">YOUR EXPERIENCE</p>
                  <h2 id="resume-title">Add your resume</h2>
                </div>
              </div>
              <p className="card-description">Upload a PDF so your practice questions can reflect your experience.</p>
              {resumeAnalysis ? (
                <div className="upload-field upload-field-success" role="status" aria-live="polite">
                  <span className="upload-icon upload-success-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <circle cx="12" cy="12" r="9" />
                      <path d="m8 12 2.5 2.5L16 9" />
                    </svg>
                  </span>
                  <span>
                    <strong>Resume analyzed successfully</strong>
                    <small>PDF analyzed and ready</small>
                  </span>
                </div>
              ) : (
                <label className="upload-field" htmlFor="resume-upload">
                  <span className="upload-icon" aria-hidden="true">↑</span>
                  <span>
                    <strong>Choose a resume PDF</strong>
                    <small>PDF format</small>
                  </span>
                  <input
                    id="resume-upload"
                    type="file"
                    accept="application/pdf"
                    onChange={handleResumeUpload}
                  />
                </label>
              )}
            </section>
            {!user && (
              <section className="dashboard-card sign-in-card" aria-labelledby="sign-in-title">
                <div className="card-heading">
                  <span className="step-marker">01</span>
                  <div>
                    <p className="eyebrow">GET STARTED</p>
                    <h2 id="sign-in-title">Sign in to InterviewAI</h2>
                  </div>
                </div>
                <p className="card-description">Use your Google account to save your interview preparation and history.</p>
                <button className="button button-secondary" onClick={handleGoogleLogin}>
                  <span className="google-mark" aria-hidden="true">G</span>
                  Sign in with Google
                </button>
              </section>
            )}
            {user && (
              <section className="dashboard-card account-card" aria-labelledby="account-title">
                <p className="eyebrow">YOUR ACCOUNT</p>
                <h2 id="account-title">You're all set</h2>
                <p className="card-description">Your interview preparation is linked to your Google account.</p>
                <div className="account-detail">
                  <span className="account-avatar" aria-hidden="true">
                    {user?.displayName?.charAt(0) || user?.email?.charAt(0) || "G"}
                  </span>
                  <span className="account-copy">
                    <strong>{user.displayName || "Signed in"}</strong>
                    <span>{user.email}</span>
                  </span>
                </div>
              </section>
            )}
            {interviewHistory.length > 0 && (
              <section className="dashboard-card interview-history" id="history">
                <div className="history-heading">
                  <div>
                    <p className="eyebrow">YOUR PROGRESS</p>
                    <h2>Interview history</h2>
                  </div>
                  <span className="history-icon" aria-hidden="true">◷</span>
                </div>
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
            {finalAnalysis && (
              <section className="dashboard-card final-report" aria-labelledby="report-title">
                <p className="eyebrow">LATEST RESULT</p>
                <h2 id="report-title">Interview report</h2>
                <p className="readiness-score">
                  {finalAnalysis.readiness_score}% · {finalAnalysis.readiness_status}
                </p>
                <ReportGroup title="Strengths" items={finalAnalysis.analysis?.performance?.strengths} />
                <ReportGroup title="Areas needing work" items={finalAnalysis.analysis?.performance?.areas_needing_work} />
                <ReportGroup title="Practice next" items={finalAnalysis.analysis?.improvement?.practice_items} />
                <p>{finalAnalysis.analysis?.readiness_reasoning}</p>
              </section>
            )}
          </aside>
        </div>

        {/* TEXT INTERVIEW */}

        {textInterviewStarted && questions.length > 0 && (
          <section className="dashboard-card interview-step-card" aria-labelledby="text-interview-title">
            <p className="eyebrow">QUESTION {currentQuestionIndex + 1} OF {questions.length}</p>
            <h2 id="text-interview-title">Your text interview</h2>
            <h3>{questions[currentQuestionIndex].question}</h3>
            <p className="question-category">Category: {questions[currentQuestionIndex].category}</p>
            <label className="form-field" htmlFor="text-answer">
              <span>Your answer</span>
              <textarea
                id="text-answer"
                rows="8"
                placeholder="Type your answer here..."
                value={currentAnswer}
                onChange={(event) => setCurrentAnswer(event.target.value)}
              />
            </label>
            <button className="button button-primary" onClick={handleSubmitAnswer}>
              {currentQuestionIndex === questions.length - 1 ? "Finish text interview" : "Submit answer"}
            </button>
          </section>
        )}

        {textInterviewCompleted && (
          <section className="dashboard-card completion-card">
            <p className="eyebrow">TEXT INTERVIEW COMPLETE</p>
            <h2>Nice work completing your answers</h2>
            <p className="card-description">You answered all {answers.length} questions. Continue when you're ready for the live interview.</p>
            <button className="button button-primary" onClick={startLiveInterview}>
              Continue to live interview <span aria-hidden="true">→</span>
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

      {cameraError && (
        <section className="dashboard-card camera-error" role="alert">
          <p>{cameraError}</p>
        </section>
      )}
      </main>
    </div>
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