const Application = require('../models/Application');
const Job = require('../models/Job');

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getFileUrl } = require('../services/storage.service');
const { skipsCodingRound, finalScoreFromApplication } = require('../utils/applicationScores');

const JOB_POPULATE_MINIMAL =
  'title domain resumeThreshold mcqThreshold codingThreshold resumeWeight mcqWeight codingWeight mcqCount mcqDuration codingDuration isActive';

// Helper to extract text from resume buffer
const extractTextFromResume = async (fileObj) => {
  try {
    let buffer;
    if (fileObj.location) {
      // S3
      const s3Response = await axios.get(fileObj.location, { responseType: 'arraybuffer' });
      buffer = Buffer.from(s3Response.data);
    } else {
      // Local
      buffer = fs.readFileSync(fileObj.path);
    }

    const mime = fileObj.mimetype || '';
    const filename = fileObj.originalname || '';

    if (mime.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) {
      const parsed = await pdfParse(buffer);
      return parsed.text || '';
    } else if (
      mime.includes('word') || 
      mime.includes('officedocument') || 
      filename.toLowerCase().endsWith('.docx') || 
      filename.toLowerCase().endsWith('.doc')
    ) {
      const parsed = await mammoth.extractRawText({ buffer });
      return parsed.value || '';
    }
    return '';
  } catch (err) {
    console.error('Error extracting text from resume:', err);
    return '';
  }
};

// Helper to calculate local keyword score
const calculateLocalKeywordScore = (text, requiredSkills) => {
  if (!requiredSkills || requiredSkills.length === 0) {
    return { score: 100, matchedCount: 0, matchedSkills: [], missingSkills: [] };
  }
  const cleanText = text.toLowerCase();
  const matchedSkills = [];
  const missingSkills = [];

  requiredSkills.forEach(skill => {
    const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(cleanText) || cleanText.includes(skill.toLowerCase())) {
      matchedSkills.push(skill);
    } else {
      missingSkills.push(skill);
    }
  });

  const matchedCount = matchedSkills.length;
  const score = Math.round((matchedCount / requiredSkills.length) * 100);

  return {
    score,
    matchedCount,
    matchedSkills,
    missingSkills
  };
};

// ─── External ATS API Integration ─────────────────────────────────────────────
const mapDomainToATS = (domain) => {
  const supported = [
    'AI/ML Engineer',
    'PHP Developer',
    'Data Engineer',
    'Data Scientist',
    'DevOps',
    'MERN Developer',
    'Python Developer',
    'Java Developer',
    'DBA',
    'Cloud Engineer',
    'Network Engineer',
    'Go Lang Developer',
    'Technical Support',
    'Business Analyst',
    '.NET Developer',
    'Data Analytics',
    'QA (Quality Assurance)',
  ];

  // Try exact match first
  const exact = supported.find(s => s.toLowerCase() === domain?.toLowerCase());
  if (exact) return exact;

  // Try partial match
  const partial = supported.find(s => domain?.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(domain?.toLowerCase()));
  if (partial) return partial;

  return 'MERN Developer'; // Default fallback
};

const parseResumeAndScore = async (fileObj, jobDomain, requiredSkills = []) => {
  // 1. Extract text first for local scoring
  const extractedText = await extractTextFromResume(fileObj);
  const localResult = calculateLocalKeywordScore(extractedText, requiredSkills);

  // 2. Call external ATS API
  let extScore = 0;
  let extMatched = [];
  let extMissing = [];
  let extFailed = false;

  try {
    const atsDomain = mapDomainToATS(jobDomain);
    const form = new FormData();
    
    if (fileObj.location) {
      // Stream from S3
      const s3Response = await axios.get(fileObj.location, { responseType: 'stream' });
      form.append('resume', s3Response.data, { filename: fileObj.originalname, contentType: fileObj.mimetype });
    } else {
      // Read from local
      form.append('resume', fs.createReadStream(fileObj.path), { filename: fileObj.originalname, contentType: fileObj.mimetype });
    }
    
    form.append('domain', atsDomain);

    const atsUrl = process.env.ATS_API_URL || 'https://atsscorer-production.up.railway.app/analyze';
    const response = await axios.post(atsUrl, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 15000,
    });

    const score = response.data.score || response.data.total_score || response.data.ats_score || 0;
    extScore = Number(score);
    extMatched = response.data.matched_skills || [];
    extMissing = response.data.missing_skills || [];
  } catch (err) {
    console.error('External ATS API error, falling back to local parsing:', err.response?.data || err.message);
    extFailed = true;
  }

  let finalScore = 0;
  let finalMatched = [];
  let finalMissing = [];

  if (extFailed) {
    // Graceful fallback to pure local keyword match score
    finalScore = localResult.score;
    finalMatched = localResult.matchedSkills;
    finalMissing = localResult.missingSkills;
  } else {
    // Blend: 70% external ATS, 30% local matching
    finalScore = Math.round((extScore * 0.7) + (localResult.score * 0.3));
    finalMatched = Array.from(new Set([...extMatched, ...localResult.matchedSkills]));
    finalMissing = Array.from(new Set([...extMissing, ...localResult.missingSkills])).filter(s => !finalMatched.includes(s));
  }

  // Capping Logic: If 0 skills matched from job's required skills, hard-cap to 25%
  if (requiredSkills.length > 0 && localResult.matchedCount === 0) {
    finalScore = Math.min(finalScore, 25);
  }

  return {
    score: finalScore,
    matchedSkills: finalMatched,
    missingSkills: finalMissing
  };
};

// ─── Candidate: Apply for Job ──────────────────────────────────────────────────
// POST /api/applications/apply/:jobId
exports.applyForJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const candidateId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job || !job.isActive) {
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, error: 'Job not found or inactive' });
    }

    const existingApp = await Application.findOne({ jobId, candidateId });
    if (existingApp) {
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'You have already applied for this job' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Resume file (PDF or Word) is required' });
    }

    const { score, matchedSkills, missingSkills } = await parseResumeAndScore(req.file, job.domain, job.requiredSkills || []);
    const isPassed = score >= job.resumeThreshold;
    const status = isPassed ? 'mcq_pending' : 'resume_rejected';

    const resumeUrl = getFileUrl(req.file, 'resumes');

    const application = await Application.create({
      jobId,
      candidateId,
      status,
      scores: {
        resume: {
          score,
          matchedSkills,
          missingSkills,
          resumeUrl,
        }
      }
    });

    const populated = await Application.findById(application._id).populate('jobId', 'title domain mcqThreshold codingThreshold resumeThreshold mcqDuration codingDuration isActive');

    res.status(201).json({
      success: true,
      message: isPassed
        ? `Resume passed ATS (${score}%). Proceed to MCQ round.`
        : `Resume scored ${score}% — below the required ${job.resumeThreshold}% threshold.`,
      data: populated,
    });
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ─── Candidate: My Applications ───────────────────────────────────────────────
// GET /api/applications/my
exports.getMyApplications = async (req, res) => {
  try {
    const apps = await Application.find({ candidateId: req.user.id })
      .populate('jobId', 'title domain resumeThreshold mcqThreshold codingThreshold resumeWeight mcqWeight codingWeight mcqDuration codingDuration isActive')
      .sort('-createdAt');
    res.status(200).json({ success: true, count: apps.length, data: apps });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// ─── Admin: All Applications (Filterable) ─────────────────────────────────────
// GET /api/applications/admin/all
exports.getAdminAllApplications = async (req, res) => {
  try {
    const { jobId, minResume, minMcq, minCoding, status } = req.query;

    const filter = {};
    if (jobId) filter.jobId = jobId;
    if (status) filter.status = status;

    let apps = await Application.find(filter)
      .populate('candidateId', 'name email avatar')
      .populate('jobId', 'title domain mcqDuration codingDuration')
      .sort('-createdAt');

    // Apply score filters in JS (simpler than complex mongo aggregation)
    if (minResume) apps = apps.filter(a => (a.scores.resume?.score || 0) >= Number(minResume));
    if (minMcq) apps = apps.filter(a => (a.scores.mcq?.score || 0) >= Number(minMcq));
    if (minCoding) apps = apps.filter(a => (a.scores.coding?.score || 0) >= Number(minCoding));

    res.status(200).json({ success: true, count: apps.length, data: apps });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// ─── Admin: Job Pipeline ───────────────────────────────────────────────────────
// GET /api/applications/job/:jobId
exports.getJobApplications = async (req, res) => {
  try {
    const apps = await Application.find({ jobId: req.params.jobId })
      .populate('candidateId', 'name email avatar')
      .sort('-createdAt');
    res.status(200).json({ success: true, count: apps.length, data: apps });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// ─── Admin: Single Application Detail ─────────────────────────────────────────
// GET /api/applications/:appId
exports.getApplicationDetail = async (req, res) => {
  try {
    const app = await Application.findById(req.params.appId)
      .populate('candidateId', 'name email avatar')
      .populate('jobId', 'title domain resumeThreshold mcqThreshold codingThreshold resumeWeight mcqWeight codingWeight');

    if (!app) return res.status(404).json({ success: false, error: 'Application not found' });

    res.status(200).json({ success: true, data: app });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// ─── Candidate: Submit MCQ ────────────────────────────────────────────────────
// POST /api/applications/:appId/mcq
exports.submitMCQ = async (req, res) => {
  try {
    const { answers } = req.body; // [{ questionId, selectedOption }]
    const application = await Application.findOne({ _id: req.params.appId, candidateId: req.user.id }).populate('jobId');

    if (!application) return res.status(404).json({ success: false, error: 'Application not found' });
    if (application.status !== 'mcq_pending') return res.status(400).json({ success: false, error: 'MCQ already submitted or not in MCQ phase' });

    const MCQ = require('../models/MCQ');
    const questions = await MCQ.find({ jobId: application.jobId._id });

    let correctCount = 0;
    const evaluatedAnswers = (answers || []).map(ans => {
      const q = questions.find(q => q._id.toString() === ans.questionId);
      const isCorrect = q && q.correctAnswer === ans.selectedOption;
      if (isCorrect) correctCount++;
      return { questionId: ans.questionId, selectedOption: ans.selectedOption, isCorrect };
    });

    const totalQuestions = application.jobId.mcqCount || questions.length || 1;
    const score = Math.round((correctCount / totalQuestions) * 100);
    const isPassed = score >= application.jobId.mcqThreshold;

    application.scores.mcq = { score, answers: evaluatedAnswers };

    const jobDomain = application.jobId?.domain;
    if (isPassed && (skipsCodingRound(application.jobId) || skipsCodingRound(jobDomain))) {
      application.scores.coding = { score: 0 };
      application.scores.finalScore = finalScoreFromApplication(application, 0);
      application.status = 'coding_passed';
    } else if (isPassed) {
      application.status = 'coding_pending';
    } else {
      application.status = 'mcq_failed';
    }

    await application.save();

    const refreshed = await Application.findById(application._id).populate('jobId', JOB_POPULATE_MINIMAL);

    const passMessage = isPassed && skipsCodingRound(jobDomain)
      ? `MCQ Passed (${score}%)! This role has no coding round — awaiting admin review.`
      : isPassed
        ? `MCQ Passed (${score}%)! Proceed to coding round.`
        : `MCQ Failed (${score}%). Required: ${application.jobId.mcqThreshold}%.`;

    res.status(200).json({
      success: true,
      data: refreshed,
      message: passMessage,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};



// ─── Admin overrides ───────────────────────────────────────────────────────────
// DELETE /api/applications/:appId
exports.deleteApplication = async (req, res) => {
  try {
    const app = await Application.findById(req.params.appId);
    if (!app) return res.status(404).json({ success: false, error: 'Application not found' });

    // optionally delete file if it exists, though storage.service logic would be better
    try {
      if (app.scores?.resume?.resumeUrl) {
        const p = path.join(process.cwd(), app.scores.resume.resumeUrl.replace(/^\/?(api\/)?/, ''));
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      }
    } catch (fsErr) {
      console.error('Failed to delete resume file during application deletion:', fsErr);
    }

    await Application.findByIdAndDelete(req.params.appId);
    res.status(200).json({ success: true, message: 'Application deleted. Candidate can re-apply.' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// POST /api/applications/:appId/override
// body: { action: 'force_mcq' | 'retry_mcq' }
exports.overrideApplicationStatus = async (req, res) => {
  try {
    const app = await Application.findById(req.params.appId).populate('jobId').populate('candidateId');
    if (!app) return res.status(404).json({ success: false, error: 'Application not found' });

    const { action } = req.body;
    let message = '';

    if (action === 'force_mcq' && app.status === 'resume_rejected') {
      app.status = 'mcq_pending';
      message = 'ATS Resume result overridden. Candidate can now take the MCQ round.';
    } else if (action === 'retry_mcq' && app.status === 'mcq_failed') {
      app.status = 'mcq_pending';
      app.set('scores.mcq', undefined);
      message = 'MCQ score reset. Candidate can retake the MCQ round.';
    } else if (action === 'retry_coding' && app.status === 'coding_failed') {
      app.status = 'coding_pending';
      app.set('scores.coding', undefined);
      message = 'Coding score reset. Candidate can retake the coding round.';
    } else if (action === 'skip_mcq' && (app.status === 'mcq_pending' || app.status === 'mcq_failed')) {
      if (skipsCodingRound(app.jobId?.domain)) {
        app.scores.coding = { score: 0 };
        app.scores.finalScore = finalScoreFromApplication(app, 0);
        app.status = 'coding_passed';
        message = 'MCQ skipped. Business Analyst roles have no coding round — pipeline complete.';
      } else {
        app.status = 'coding_pending';
        message = 'MCQ round skipped. Candidate proceeds to coding.';
      }
    } else if (action === 'skip_coding' && (app.status === 'coding_pending' || app.status === 'coding_failed')) {
      app.scores.coding = { score: 100 };
      app.scores.finalScore = finalScoreFromApplication(app, 100);
      app.status = 'coding_passed';
      message = 'Coding round skipped. Candidate proceeds to final selection.';
    } else if (action === 'mark_hired' && app.status === 'coding_passed') {
      app.status = 'hired';
      message = 'Candidate marked as hired.';
    } else if (action === 'mark_rejected' && app.status === 'coding_passed') {
      app.status = 'rejected';
      message = 'Candidate marked as rejected.';
    } else {
      return res.status(400).json({ success: false, error: `Action '${action}' not available for current stage '${app.status}'` });
    }

    await app.save();
    res.status(200).json({ success: true, data: app, message });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
