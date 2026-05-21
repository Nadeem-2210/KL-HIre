const Application = require('../models/Application');
const Job = require('../models/Job');

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { getFileUrl } = require('../services/storage.service');
const { skipsCodingRound, finalScoreFromApplication } = require('../utils/applicationScores');

const JOB_POPULATE_MINIMAL =
  'title domain resumeThreshold mcqThreshold codingThreshold resumeWeight mcqWeight codingWeight mcqCount mcqDuration codingDuration isActive';



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

const localParseAndScore = async (fileObj, job) => {
  let dataBuffer;
  if (fileObj.location) {
    const s3Response = await axios.get(fileObj.location, { responseType: 'arraybuffer' });
    dataBuffer = Buffer.from(s3Response.data);
  } else {
    dataBuffer = fs.readFileSync(fileObj.path);
  }

  const ext = path.extname(fileObj.originalname).toLowerCase();
  let text = '';

  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(dataBuffer);
      text = data.text;
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      text = result.value;
    } else if (ext === '.doc') {
      // Basic fallback for old binary .doc format
      const matches = dataBuffer.toString('binary').match(/[a-zA-Z0-9\s\-\.\,\@\:\/\#]{3,}/g);
      text = matches ? matches.join(' ') : '';
    } else {
      // .txt or unknown
      text = dataBuffer.toString('utf8');
    }
  } catch (e) {
    console.error('Local extraction error:', e);
  }

  const domainSkills = {
    'AI/ML Engineer': ['python', 'pytorch', 'tensorflow', 'scikit-learn', 'keras', 'machine learning', 'deep learning', 'nlp', 'computer vision', 'data science', 'pandas', 'numpy'],
    'PHP Developer': ['php', 'laravel', 'symfony', 'codeigniter', 'mysql', 'wordpress', 'javascript', 'jquery', 'ajax', 'html', 'css'],
    'Data Engineer': ['sql', 'python', 'spark', 'hadoop', 'etl', 'data warehouse', 'aws', 'gcp', 'airflow', 'kafka', 'database', 'scala'],
    'Data Scientist': ['python', 'r', 'machine learning', 'pandas', 'numpy', 'statistics', 'sql', 'data analysis', 'visualization', 'jupyter'],
    'DevOps': ['docker', 'kubernetes', 'jenkins', 'ci/cd', 'aws', 'terraform', 'ansible', 'linux', 'git', 'bash', 'prometheus', 'grafana'],
    'MERN Developer': ['react', 'node.js', 'express', 'mongodb', 'javascript', 'redux', 'html', 'css', 'typescript', 'next.js'],
    'Python Developer': ['python', 'django', 'flask', 'fastapi', 'sql', 'git', 'numpy', 'pandas', 'rest api', 'javascript'],
    'Java Developer': ['java', 'spring', 'spring boot', 'hibernate', 'maven', 'gradle', 'mysql', 'microservices', 'junit', 'git'],
    'DBA': ['sql', 'mysql', 'oracle', 'postgresql', 'sql server', 'database', 'backup', 'tuning', 'recovery', 'nosql', 'replication'],
    'Cloud Engineer': ['aws', 'azure', 'gcp', 'cloud', 'terraform', 'iam', 'ec2', 's3', 'serverless', 'devops', 'kubernetes'],
    'Network Engineer': ['cisco', 'routing', 'switching', 'vpn', 'firewall', 'dns', 'dhcp', 'tcp/ip', 'lan', 'wan', 'security', 'network'],
    'Go Lang Developer': ['go', 'golang', 'goroutines', 'docker', 'kubernetes', 'grpc', 'rest api', 'sql', 'git', 'microservices'],
    'Technical Support': ['troubleshooting', 'helpdesk', 'active directory', 'windows', 'linux', 'hardware', 'customer support', 'it support', 'networks'],
    'Business Analyst': ['requirements', 'agile', 'scrum', 'sql', 'excel', 'jira', 'uml', 'use cases', 'data analysis', 'communication'],
    '.NET Developer': ['.net', 'c#', 'asp.net', 'entity framework', 'sql server', 'mvc', 'web api', 'javascript', 'azure'],
    'Data Analytics': ['sql', 'excel', 'tableau', 'power bi', 'python', 'r', 'data analysis', 'statistics', 'reporting', 'pandas'],
    'QA (Quality Assurance)': ['testing', 'selenium', 'automation', 'manual testing', 'jest', 'cypress', 'qa', 'test cases', 'bug tracking', 'jira']
  };

  const domain = job.domain || 'MERN Developer';
  const reqSkills = Array.isArray(job.requiredSkills) ? job.requiredSkills : [];
  const matchedDomainSkills = domainSkills[domain] || domainSkills['MERN Developer'];




  const normalizedText = text.toLowerCase();
  const matched = [];
  const missing = [];
  const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Build unified target list: reqSkills first, then domain skills
  const reqNorm = reqSkills.map(s => s.trim().toLowerCase()).filter(Boolean);
  const domNorm = matchedDomainSkills.map(s => s.toLowerCase());

  // Deduplicate: use Set, reqSkills take priority for display name
  const allTargetNorm = Array.from(new Set([...reqNorm, ...domNorm]));

  for (const skill of allTargetNorm) {
    const escaped = escapeRegExp(skill);
    const regexStr = (skill === 'c++') ? 'c\\+\\+' : (skill === 'c#') ? 'c#' : (skill === '.net') ? '\.net' : '\\b' + escaped + '\\b';
    const regex = new RegExp(regexStr, 'i');
    const displayName = reqSkills.find(s => s.toLowerCase() === skill) ||
                        matchedDomainSkills.find(s => s.toLowerCase() === skill) || skill;
    if (regex.test(normalizedText)) {
      matched.push(displayName);
    } else {
      missing.push(displayName);
    }
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  let score;
  if (reqNorm.length >= 3) {
    // Primary: required skills weighted at 70%, domain skills at 30%
    const reqMatched = matched.filter(s => reqNorm.includes(s.toLowerCase())).length;
    const domMatched = matched.filter(s => !reqNorm.includes(s.toLowerCase())).length;
    const reqScore   = reqNorm.length > 0 ? (reqMatched / reqNorm.length) * 70 : 70;
    const domScore   = domNorm.length  > 0 ? (domMatched / domNorm.length)  * 30 : 30;
    score = Math.round(reqScore + domScore);
    // Only hard-cap if ZERO required skills matched (completely unrelated resume)
    if (reqMatched === 0) score = Math.min(score, 30);
  } else {
    // Simple ratio when no/few required skills are defined by admin
    score = allTargetNorm.length > 0
      ? Math.round((matched.length / allTargetNorm.length) * 100)
      : 85;
  }

  // Safety floor — if text extraction failed (very short text), avoid false rejection
  if (text.length < 100) score = Math.max(score, job.resumeThreshold || 70);
  // Safety floor for binary .doc files that may not parse well
  if (text.length < 50 && ext === '.doc') score = Math.max(score, job.resumeThreshold || 70);

  return {
    score,
    matchedSkills: matched,
    missingSkills: missing
  };
};


const parseResumeAndScore = async (fileObj, job) => {
  try {
    const atsDomain = mapDomainToATS(job.domain);
    const form = new FormData();

    if (fileObj.location) {
      // Stream from S3
      const s3Response = await axios.get(fileObj.location, { responseType: 'stream' });
      form.append('resume', s3Response.data, { filename: fileObj.originalname, contentType: fileObj.mimetype });
    } else {
      // Read from local disk
      form.append('resume', fs.createReadStream(fileObj.path), { filename: fileObj.originalname, contentType: fileObj.mimetype });
    }

    form.append('domain', atsDomain);

    const response = await axios.post('https://dhanesh-96-ats-scorer.hf.space/analyze', form, {
      headers: { ...form.getHeaders() },
      timeout: 30000, // 30s — HF Spaces can be slow on cold start
    });

    const data = response.data;

    // New API returns: ats_score, skills_found, skills_in_domain
    const score = Number(data.ats_score ?? data.score ?? data.total_score ?? 0);

    const matchedSkills = data.skills_found || [];
    // Missing = domain skills that were NOT found in the resume
    const domainSkills  = data.skills_in_domain || [];
    const foundSet      = new Set(matchedSkills.map(s => s.toLowerCase()));
    const missingSkills = domainSkills.filter(s => !foundSet.has(s.toLowerCase()));

    return { score, matchedSkills, missingSkills };

  } catch (err) {
    console.error('External ATS API error:', err.response?.data || err.message, '— falling back to local parser...');
    return await localParseAndScore(fileObj, job);
  }
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

    const { score, matchedSkills, missingSkills } = await parseResumeAndScore(req.file, job);
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
    if (isPassed && skipsCodingRound(jobDomain)) {
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
