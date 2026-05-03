# Emotional Space AI — Cursor Handoff

## 1. Project context

This prototype belongs to the **1st-floor space** of the graduation project, not the healing/recovery space itself.

### Core narrative
- **1st floor** represents a **technology-centered society**.
- It shows **how society intervenes in individual emotion** through sensing, data processing, and environmental control.
- The project is informed by an **ANT (Actor-Network Theory)** worldview: emotion is not purely internal, but becomes entangled with sensors, algorithms, interfaces, data, and spatial devices.
- Therefore, the AI system is **not a therapeutic assistant**.
- It is a **visible system of social intervention**: it detects emotional conditions and modulates the environment in response.
- The user is **critical of this mechanism**. The system should reveal the unsettling logic of technological society intruding into emotional life.

### Important conceptual distinction
- **2nd floor** = emotional recovery / human-centered recovery space.
- **1st floor** = measurement, interpretation, and algorithmic intervention.

So the prototype should not feel too warm, cute, or purely supportive.
It should feel like:
- observation
- system monitoring
- algorithmic interpretation
- environmental adjustment based on collective emotional data

---

## 2. Prototype goal

Build a working exhibition prototype in which:
- an **Android tablet** acts as the visible interface and input device,
- the tablet browser uses its **camera + microphone**,
- a **desktop server** receives the data,
- the server analyzes emotion / people / occupancy / noise,
- the server controls a **Tapo smart light**,
- the tablet displays the live camera feed and system UI.

This is a **browser-based tablet input system**, not a laptop webcam app.

---

## 3. Hardware / device situation

### Available devices
- **Desktop PC**
  - no webcam
  - no microphone
  - acts as main processing server
  - runs Python backend
  - controls Tapo light
- **Android tablet**
  - must provide camera + microphone input
  - must also display the UI
- **Tapo smart light**
  - brightness + color temperature control required

### Network assumption
- Desktop and tablet are on the **same local Wi-Fi network**.
- Tablet opens the desktop server in the browser via local IP.

Example:
- Desktop server URL: `http://192.168.x.x:8000`
- Tablet accesses that URL in Chrome.

---

## 4. Technical direction

The user chose **option 2**:

### Required architecture
A **browser-based tablet web app**.

#### Tablet side
- opens web page in browser
- requests camera + microphone permission
- shows live camera preview
- overlays face boxes and emotion labels
- shows system UI and current state
- sends image/audio data to desktop backend

#### Desktop side
- receives frames/audio from tablet
- sends image frames to **Google Cloud Vision API** for face emotion analysis
- computes:
  - emotion averages
  - people count
  - occupancy duration
  - noise level
  - current policy state
- controls **Tapo light**
- sends analysis results back to tablet UI

### Recommended stack
Use something like:
- **FastAPI** backend
- **WebSocket** for real-time communication
- frontend:
  - HTML
  - CSS
  - JavaScript
- Python modules separated for:
  - policy/state logic
  - emotion processing
  - Tapo control
  - server logic

Do **not** build this as a single monolithic script if avoidable.

---

## 5. Functional requirements

### 5.1 Tablet input
The tablet browser should:
- capture camera input
- capture microphone input
- show live video preview
- send periodic frames to server
- send simple audio loudness / noise level data to server

The user does **not** need advanced speech or audio recognition.
Only **noise level** is needed.

### 5.2 Face visualization on UI
When a face is detected, the UI should show:
- a **rectangle bounding box** around the face
- on the **right side of the face box**, emotion labels in **English only**
- multiple lines are allowed

Required emotion labels:
- Joy
- Sorrow
- Anger
- Surprise
- Neutral

### 5.3 Emotion percentages
The UI should show percentages that add up to **exactly 100%**.

Important instruction from user:
- Do not show weird partial percentages that do not sum to 100.
- Use the received emotion values and normalize them.

#### Expected approach
From Google Vision face likelihoods:
- joy
- sorrow
- anger
- surprise

Map the likelihoods to scores, for example:
- UNKNOWN = 0
- VERY_UNLIKELY = 1
- UNLIKELY = 2
- POSSIBLE = 3
- LIKELY = 4
- VERY_LIKELY = 5

Then derive:
- `neutral = max(0, 5 - max(joy, sorrow, anger, surprise))`

Then normalize:
- `Joy + Sorrow + Anger + Surprise + Neutral = 100%`

The user prefers all emotion lines to be shown, not only top 2.

### 5.4 Collective / recent smoothing
Emotion decision should not use just one frame.
Use the **recent 5 emotion results** to stabilize the system.

The user explicitly requested:
- use **recent five** emotion data points

### 5.5 People count
Use detected face count as people count.

### 5.6 Occupancy duration
The user does **not** want person tracking.

Instead, define occupancy as:
- if **at least one face** is detected, occupancy is active
- occupancy duration starts when face count becomes `>= 1`
- occupancy duration continues while faces remain visible
- occupancy ends when face detection is lost long enough

Use a small grace period (about 2–3 seconds) so temporary detection failure does not instantly reset occupancy.

This is **space occupancy duration**, not individual dwell time.

### 5.7 Noise level
Use the tablet microphone to estimate:
- low
- medium
- high
or a normalized scalar 0–1

Only simple loudness is required.

### 5.8 Light control
For now, only **light control** is required.

Do **not** implement white noise output or louver control yet.
The user deliberately reduced scope.

Tapo light should support:
- brightness
- color temperature

---

## 6. Conceptual meaning of the AI system

This is extremely important.

The prototype should **not** be framed as:
- healing AI
- comforting AI
- emotionally supportive AI

It should instead be framed as:
- a system that **reads emotional conditions as data**
- interprets them algorithmically
- and **intervenes in the environment**

Suggested conceptual framing:
> The prototype reveals how technological society measures, interprets, and intervenes in collective emotional conditions through sensors, algorithms, and spatial systems.

The AI is not there to “care” for the user.
It is there to expose a logic of **algorithmic mediation and intervention**.

The UI should therefore feel:
- visible
- system-like
- analytical
- somewhat cold / institutional
- not playful or sentimental

---

## 7. Policy / rule set to implement

Although this is described as an **AI-authored policy**, the actual exhibition runtime can execute a fixed policy.
The user wants to claim that the policy was designed by AI beforehand, even if runtime is deterministic.

### Inputs
Use these runtime inputs:
- `people_count`
- `noise_level`
- `occupancy_time`
- recent-5 averaged:
  - `joy_avg`
  - `sorrow_avg`
  - `anger_avg`
  - `surprise_avg`

### Derived values
Use something close to:
- `crowding = people_count / capacity`
- `stress = anger_avg + surprise_avg + noise_level * 0.5`
- `mood = joy_avg - sorrow_avg`
- occupancy score may be derived if useful

A small face-capacity value can be assumed for prototype, e.g. `capacity = 6`.

### State categories
Implement **4 states**.

#### 1) `idle`
Condition:
- `people_count == 0`
- or `occupancy_time < 3s`

Meaning:
- system idle / no stable occupation yet

Light policy:
- brightness: **55**
- color temperature: **4000K**

#### 2) `observed_crowd`
Condition:
- people present
- stress not high
- default active state

Meaning:
- people are present, being observed, but not in a stressed condition

Light policy:
- brightness: **65**
- color temperature: **4200K**

#### 3) `managed_stress`
Condition:
- `stress > 0.8`
- or noise level high

Meaning:
- system detects collective tension / overstimulation and intervenes

Light policy:
- brightness: **50**
- color temperature: **3000K**

#### 4) `algorithmic_activation`
Condition:
- negative mood / low affect
- something close to `mood < -0.3`

Meaning:
- system re-adjusts the environment in response to emotional stagnation or low affect

Light policy:
- brightness: **75**
- color temperature: **4600K**

### State priority
Use this priority order:
1. if no people or occupancy too short → `idle`
2. else if stress high → `managed_stress`
3. else if mood negative enough → `algorithmic_activation`
4. else → `observed_crowd`

This should be clearly implemented in the backend.

---

## 8. Existing code history to preserve

The user already had a Python script using:
- **Google Cloud Vision API** for face emotion detection
- **Tapo control** for smart light
- recent emotion averaging

That code should be treated as the conceptual base.
The new project is **not** starting from scratch conceptually.

The previous working direction included:
- Vision-based emotion detection
- remapping likelihood values
- recent-5 smoothing
- Tapo brightness/color temp control

Now this needs to be **restructured** into a browser-tablet + desktop-server architecture.

---

## 9. UI requirements

The UI is important because the user wants the AI system to be **fully visible**.
The camera feed, analysis, and system decision should all be visible.

### UI should show
- live camera preview
- face bounding boxes
- right-side emotion list for each face
- current people count
- noise level
- occupancy time
- current state
- light setting

### Example UI fields
- `PEOPLE DETECTED: 3`
- `NOISE LEVEL: MEDIUM`
- `OCCUPANCY TIME: 18s`
- `SYSTEM MODE: MANAGED_STRESS`
- `LIGHT: 3000K / 50%`

### Tone
The text should feel like:
- monitoring interface
- system dashboard
- not therapeutic
- not playful

Possible extra phrase:
- `ENVIRONMENTAL ADJUSTMENT IN PROGRESS`
- `BASED ON COLLECTIVE EMOTIONAL DATA`

### Language
All visible text should be in **English**, not Korean.

---

## 10. Suggested project structure for Cursor

```text
emotion-ai-space/
├─ backend/
│  ├─ main.py                 # FastAPI app
│  ├─ config.py               # env/config values
│  ├─ emotion_engine.py       # Vision API emotion parsing
│  ├─ policy.py               # state derivation + lighting policy
│  ├─ occupancy.py            # occupancy timer logic
│  ├─ audio_utils.py          # noise normalization helpers
│  ├─ tapo_controller.py      # Tapo light control
│  └─ models.py               # pydantic / data structures
├─ frontend/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ requirements.txt
└─ README.md
```

This can be simplified, but avoid a single giant file if possible.

---

## 11. Suggested implementation plan

### Phase 1 — local UI and browser capture
- tablet opens page from desktop IP
- browser requests camera/mic permissions
- live preview appears
- JS computes microphone loudness
- JS sends frames + noise values to backend

### Phase 2 — backend analysis
- backend receives frame
- sends image to Google Cloud Vision
- extracts faces + emotion likelihoods
- computes normalized percentages
- stores recent 5 emotion vectors
- updates occupancy logic
- derives state

### Phase 3 — Tapo control
- backend sends light updates only when state changes or enough time has passed
- avoid spamming light commands every frame

### Phase 4 — UI overlay
- backend returns face boxes + percentages + state data
- frontend renders overlays over camera preview

---

## 12. Practical notes for Android browser version

Because the tablet is Android, browser implementation is feasible.
Use mobile Chrome if possible.

Suggested frontend approach:
- `navigator.mediaDevices.getUserMedia()` for camera + mic
- `<video>` for preview
- `<canvas>` overlay for face boxes and labels
- periodic frame capture from canvas to backend
- WebSocket or repeated POST requests for analysis

Noise level can be approximated using Web Audio API:
- create `AudioContext`
- connect mic stream
- compute RMS or average amplitude
- send normalized value periodically

---

## 13. Design warnings / constraints

- Do not let the system read as a friendly emotional assistant.
- Do not overcomplicate with too many states.
- Do not add white-noise output yet.
- Do not add louver control yet.
- Do not rely on person tracking.
- Do not require webcam/microphone on desktop.
- Input must come from the **tablet browser**.

---

## 14. What Cursor should build next

The next implementation target should be:

### MVP
A browser-based Android tablet interface + desktop backend where:
- tablet camera and mic are captured in browser
- frames/noise are sent to server
- server analyzes with Google Vision
- server computes state with recent-5 smoothing and occupancy logic
- server controls Tapo light
- tablet shows live system UI with bounding boxes and emotion percentages

---

## 15. Short brief for Cursor AI

Use this as a direct working brief inside Cursor:

> Build a browser-based Android-tablet input system for an exhibition prototype. The tablet browser must capture camera and microphone input, show the live camera feed, and display face bounding boxes with English emotion labels and percentages summing to 100%. The desktop Python backend must receive frames/audio level data, analyze faces using Google Cloud Vision, compute recent-5 averaged emotion values, people count, occupancy duration, and current policy state, and control a Tapo smart light (brightness + color temperature only). The conceptual framing is not healing or supportive AI; it is a visible system of algorithmic social intervention into emotion. Implement four states: idle, observed_crowd, managed_stress, algorithmic_activation, with the policy values and priority described in this document.

