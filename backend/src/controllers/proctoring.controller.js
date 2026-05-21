const ProctoringLog = require('../models/ProctoringLog');
const { Groq } = require('groq-sdk');

// Initialize Groq SDK
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Helper to compare reference photo and violation screenshot using Groq Vision
const compareFacesWithGroq = async (referenceBase64, currentBase64) => {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.2-11b-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Compare these two candidate screenshots from an online exam. The first image is the verified reference photo of the registered candidate. The second image is a proctoring alert snapshot taken during the exam. Determine if both images depict the EXACT SAME person. If they are different people, matched must be false. Respond strictly in JSON format matching this schema: { "matched": boolean, "confidence": number, "explanation": "string" }'
            },
            {
              type: 'image_url',
              image_url: {
                url: referenceBase64
              }
            },
            {
              type: 'image_url',
              image_url: {
                url: currentBase64
              }
            }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { matched: true, confidence: 100, explanation: 'No response from Groq Vision.' };
    }
    const parsed = JSON.parse(content);
    return parsed;
  } catch (err) {
    console.error('Groq Face Match error:', err.message);
    return { matched: true, confidence: 100, explanation: 'Failed to run AI comparison: ' + err.message };
  }
};

// POST /api/proctoring/log
// Called by the frontend hooks (useTabProctor, useFaceProctor, FaceCheckModal)
exports.saveLog = async (req, res) => {
  try {
    const { sessionId, eventType, description, severity, screenshot, metadata } = req.body;

    if (!sessionId || !eventType) {
      return res.status(400).json({ success: false, error: 'sessionId and eventType are required' });
    }

    let finalSeverity = severity;
    let finalDescription = description;
    let enrichedMetadata = metadata || {};

    // Face matching verification using Groq Vision
    if (
      screenshot && 
      eventType !== 'face_reference_captured' && 
      eventType !== 'camera_blocked' && 
      eventType !== 'no_face_detected'
    ) {
      try {
        const referenceLog = await ProctoringLog.findOne({
          sessionId,
          eventType: 'face_reference_captured'
        });

        if (referenceLog && referenceLog.screenshot) {
          const matchResult = await compareFacesWithGroq(referenceLog.screenshot, screenshot);
          if (matchResult && matchResult.matched === false) {
            finalSeverity = 'critical';
            finalDescription = `${description} [CRITICAL: Face mismatch detected! The person in the frame does not match the registered candidate. Confidence: ${matchResult.confidence || 0}%, Explanation: ${matchResult.explanation}]`;
            enrichedMetadata = {
              ...enrichedMetadata,
              faceMatch: {
                matched: false,
                confidence: matchResult.confidence,
                explanation: matchResult.explanation
              }
            };
          } else if (matchResult) {
            enrichedMetadata = {
              ...enrichedMetadata,
              faceMatch: {
                matched: true,
                confidence: matchResult.confidence,
                explanation: matchResult.explanation
              }
            };
          }
        }
      } catch (faceErr) {
        console.error('Error during face comparison:', faceErr);
      }
    }

    const log = await ProctoringLog.create({
      sessionId,
      eventType,
      description: finalDescription,
      severity: finalSeverity,
      screenshot,
      metadata: enrichedMetadata,
    });

    res.status(201).json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/proctoring/session/:sessionId
// Get all logs for a specific session
exports.getSessionLogs = async (req, res) => {
  try {
    const logs = await ProctoringLog.find({ sessionId: req.params.sessionId }).sort('createdAt');
    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/proctoring/application/:appId
// Get all logs for an entire application (both mcq and coding rounds)
exports.getApplicationLogs = async (req, res) => {
  try {
    const appId = req.params.appId;
    const logs = await ProctoringLog.find({
      sessionId: { $in: [`mcq-${appId}`, `coding-${appId}`] }
    }).sort('createdAt');

    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
