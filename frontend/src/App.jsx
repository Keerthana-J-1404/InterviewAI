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

  const [liveInterviewStarted, setLiveInterviewStarted] = useState(false)
  const [cameraStream, setCameraStream] = useState(null)
  const [cameraError, setCameraError] = useState("")

  const videoRef = useRef(null)

  // Text interview state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [currentAnswer, setCurrentAnswer] = useState("")
  const [answers, setAnswers] = useState([])
  const [textInterviewStarted, setTextInterviewStarted] = useState(false)
  const [textInterviewCompleted, setTextInterviewCompleted] = useState(false)

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

      console.log("Camera and microphone access granted")
    } 
    catch (error) {
      console.error("Camera/microphone access failed:", error)
      setCameraError(
        "Camera and microphone access is required for the live interview."
      )
    }
  }

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
        <section>
          <h2>Live AI Interview</h2>

          <div>
           <h3>Your Camera</h3>

            <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            width="500"
            />
          </div>

          <p>🎤 Microphone: Active</p>
          <p>📹 Camera: Active</p>

          <button
            onClick={() => {
              if (cameraStream) {
                cameraStream.getTracks().forEach((track) => track.stop())
              }

              setCameraStream(null)
              setLiveInterviewStarted(false)
            }}
          > 
          End Interview
          </button>
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

export default App