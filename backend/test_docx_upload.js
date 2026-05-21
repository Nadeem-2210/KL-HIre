const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000/api';

async function runTest() {
  try {
    console.log('1. Registering admin...');
    const adminRegRes = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Admin Tester',
      email: 'admin_test_upload@example.com',
      password: 'password123',
      role: 'admin',
      adminKey: 'admin123'
    });
    const adminToken = adminRegRes.data.token;
    console.log('Admin token received.');

    console.log('2. Creating a test job...');
    const jobRes = await axios.post(`${BASE_URL}/jobs`, {
      title: 'MERN Developer Upload Test',
      domain: 'MERN Developer',
      description: 'Test position.',
      requiredSkills: 'React',
      resumeThreshold: 0,
      mcqThreshold: 0,
      codingThreshold: 0,
      resumeWeight: 30,
      mcqWeight: 30,
      codingWeight: 40
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const jobId = jobRes.data.data._id;
    console.log(`Job created with ID: ${jobId}`);

    console.log('3. Registering candidate...');
    const candRegRes = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Candidate Tester',
      email: 'cand_test_upload@example.com',
      password: 'password123',
      role: 'candidate',
      domain: 'MERN Developer'
    });
    const candidateToken = candRegRes.data.token;
    console.log('Candidate token received.');

    console.log('4. Applying for job with docx resume...');
    const form = new FormData();
    // Use the resume.docx we created
    const docxPath = path.resolve(__dirname, '../frontend/resume.docx');
    form.append('resume', fs.createReadStream(docxPath), 'resume.docx');

    const applyRes = await axios.post(`${BASE_URL}/applications/apply/${jobId}`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${candidateToken}`
      }
    });

    console.log('Apply response status:', applyRes.status);
    console.log('Apply response data:', applyRes.data);

    if (applyRes.data.success) {
      console.log('✅ Upload request returned success: true');
      
      const resumeUrl = applyRes.data.data.scores.resume.resumeUrl;
      console.log('Saved resume URL:', resumeUrl);

      // Verify filesystem storage
      const localFilename = path.basename(resumeUrl);
      const targetFilePath = path.join(__dirname, 'uploads/resumes', localFilename);
      
      if (fs.existsSync(targetFilePath)) {
        console.log(`✅ SUCCESS! File exists on filesystem at correct location: ${targetFilePath}`);
      } else {
        console.error(`❌ FAILURE! File NOT found at ${targetFilePath}`);
        process.exit(1);
      }
    } else {
      console.error('❌ Apply failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error during test:', error.response?.data || error.message);
    process.exit(1);
  }
}

runTest();
