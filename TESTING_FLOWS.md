# 🧪 KL-Hire Recruitment Portal - Manual Testing & Verification Flow

This guide outlines step-by-step instructions for testing all completed features and proctoring enhancements in both the **Admin Panel** and the **Candidate Panel**.

---

## 🔒 Preliminary Setup & Accounts
Ensure your dev servers are running:
* **Frontend**: `http://localhost:5173`
* **Backend**: `http://localhost:5001`

Use existing or create new accounts for validation:
* **Candidate Account**: Register at `http://localhost:5173/register/candidate`
* **Admin Account**: Sign in or use existing admin credentials at the employee sign-in page.

---

## 📋 1. Password Visibility Toggles
**Goal**: Verify that candidates can safely toggle password visibility on login and registration pages.

### Step-by-Step Test:
1. Navigate to the candidate registration page (`/register/candidate`).
2. Type `mysecurepassword` into the **Password** field. It should initially display as masked bullets (`••••••••`).
3. Click the inline **🙈 Monkey (Hide/Masked)** button inside the field. The text should transition to readable plain text (`mysecurepassword`) and the icon will change to **👁️ (Eye)**.
4. Verify the exact same behavior for the **Confirm Password** field.
5. Navigate to the candidate login page (`/login`) and verify the password toggle works there as well.

---

## 💻 2. Admin: Coding Question Filters
**Goal**: Verify that coding questions in the global question bank can be filtered dynamically by domain or job.

### Step-by-Step Test:
1. Sign in as an **Admin** and navigate to the **Coding Questions** tab in the sidebar.
2. Locate the two dropdown filters at the top:
   * **Filter by Job Role**
   * **Filter by Domain**
3. Select a job role (e.g. *MERN Developer*). The list of coding questions below should instantly filter to display only questions designated for the *MERN* domain or *All* domains.
4. Manually change the **Domain** filter to a specialized domain (e.g. *DevOps*). Verify the list updates immediately.
5. Select a domain or job role with zero questions matching. Verify that a dashed container with the message:
   `🔍 No coding questions match the selected filter (Domain: ...)` appears instead of an empty white screen.

---

## 🎯 3. Candidate: Bounding Oval & Single-Face Verification
**Goal**: Enforce single-face capture and strict geometric alignment within the dashed guide.

### Step-by-Step Test:
1. Log in as a candidate, select a job, and click **Start Test** (or go to MCQ/Coding rounds).
2. The **Face Verification Modal** will load. It will display `⏳ Initializing AI...` on the capture button until the MediaPipe face detector resolves.
3. Once initialized, the button will change to `📸 Capture Reference Photo`.
4. **Test Scenario A (No Face)**: Move out of the camera view entirely and click **Capture Reference Photo**.
   * *Expected Result*: After the countdown, a glassmorphic warning banner appears:
     `⚠️ No face detected. Please position your face inside the oval and try again.`
5. **Test Scenario B (Multiple Faces)**: Have a second person stand in the camera frame with you and click capture.
   * *Expected Result*: After the countdown, the warning banner appears:
     `⚠️ Multiple faces detected. Only one person should be visible in the frame.`
6. **Test Scenario C (Face Not Centered)**: Position your face at the very edge of the camera view (outside the dashed oval guide) and click capture.
   * *Expected Result*: After the countdown, the warning banner appears:
     `⚠️ Verification failed: Please center your face inside the dashed oval guide.`
7. **Test Scenario D (Correct Centering)**: Align your face comfortably inside the dashed guide and capture.
   * *Expected Result*: Verification succeeds, the green success banner shows, and the `🚀 Start Test` button becomes active.

---

## 📄 4. Candidate: Resume Processing, Local Parser & Skill Blending
**Goal**: Verify that PDF and Word formats process successfully, and skill matching caps irrelevant resumes.

### Step-by-Step Test:
1. Create/Modify a Job in the Admin panel and set:
   * **Required Skills**: `["React", "Node.js", "Express", "MongoDB"]`
   * **Resume Threshold**: `60`
2. **Test Scenario A (Irrelevant Resume - Hard Cap 25%)**:
   * Apply for the job as a candidate using a resume containing zero matching skills (e.g., a pure history major resume).
   * *Expected Result*: The backend uses `pdf-parse`/`mammoth` to scan the document, finds `0` keyword matches, and caps the score to **25%**. The candidate is immediately rejected and cannot proceed.
3. **Test Scenario B (Relevant Resume - Blended Score)**:
   * Apply using a MERN stack resume containing `React`, `Node.js`, and `Express`.
   * *Expected Result*: The backend blends the external ATS score (70% weight) with local keyword matching (30% weight). The final score exceeds `60%`, allowing the candidate to advance to the MCQ phase.
4. **Test Scenario C (Word Document Format)**:
   * Apply using a `.docx` Word document.
   * *Expected Result*: Multer parses the multipart stream correctly with correct mime headers, and the document is evaluated successfully without stream metadata errors.

---

## 📹 5. Candidate: Webcam PiP Dragging & Focus Protection
**Goal**: Verify the webcam Picture-in-Picture display can be dragged smoothly and does not steal focus.

### Step-by-Step Test:
1. Start an MCQ or Coding test round.
2. The webcam PiP container will display in the bottom corner of the screen.
3. **Focus Protection**: Click anywhere on the `<video>` feed inside the PiP box.
   * *Expected Result*: Focus remains on the exam. No context menus or Picture-in-Picture window menus steal focus, preventing accidental focus-loss strikes.
4. **PiP Dragging**: Click and hold the borders or header of the PiP box and drag it across the screen.
   * *Expected Result*: The box drags smoothly and follows your cursor/finger.
   * **Boundary Enforcement**: Try to drag the PiP box completely off the screen.
   * *Expected Result*: The box will stop dragging at the edges of the browser viewport, keeping it visible at all times.

---

## 📱 6. Candidate: Mobile Usage Detection Heuristic
**Goal**: Verify that downward-looking gaze (e.g. looking at a mobile screen) is detected and logged.

### Step-by-Step Test:
1. During an active test round, sit normally looking at the screen.
2. Direct your gaze steadily down towards your desk/keyboard area (simulating looking at a phone screen in your hands).
3. Keep your face tilted down so that your bounding box's vertical center (`centerY`) exceeds `0.58`.
4. Hold this downward gaze for more than **3 seconds**.
5. *Expected Result*: The proctoring system triggers a violation log:
   `EventType: mobile_usage_suspected` (Description: `Sustained downward gaze detected — mobile usage suspected.`).
6. In the Admin Dashboard candidate details page, check the proctoring logs. Verify a high-severity alert for "Mobile usage suspected" is visible with a corresponding captured screenshot.

---

## 👁️ 7. Vision-Based Face Match & Mismatch Verification
**Goal**: Compare captured proctoring violation snapshots with the registration reference photo using Groq Vision.

### Step-by-Step Test:
1. Start a test and complete the initial face capture successfully (Test registration reference photo saved in DB).
2. **Trigger a violation** (e.g. look away from the screen for 2-3 seconds, or let a different person look at the camera).
3. The frontend captures a violation snapshot and sends it to the backend endpoint `/api/proctoring/log`.
4. The backend queries the database for the initial reference photo and forwards both images to `llama-3.2-11b-vision-preview`.
5. **Test Scenario A (Same Person)**: You look away and trigger a look-away alert.
   * *Expected Result*: Groq Vision confirms same person. Severity is saved as `medium` or `high` depending on original type.
6. **Test Scenario B (Different Person)**: Have a different person step in front of the camera and trigger a violation alert.
   * *Expected Result*: Groq Vision detects a face mismatch. The backend automatically:
     * Elevates the log severity to **`critical`**.
     * Appends: `[CRITICAL: Face mismatch detected! The person in the frame does not match the registered candidate. Confidence: ...]` to the database log description.
7. Open the Admin pipeline, click the candidate's name to view their profile, and check the proctoring logs. Verify that the face-mismatch violation is highlighted in **critical red** with detailed confidence metrics.
