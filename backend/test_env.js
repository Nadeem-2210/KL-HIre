const axios = require('axios');
require('dotenv').config();

async function run() {
  try {
    const health = await axios.get('http://127.0.0.1:5001/api/health');
    console.log('HEALTH SUCCESS:', health.status, health.data);
  } catch (err) {
    console.log('HEALTH ERROR:', err.response?.status, err.response?.data, err.message);
  }

  try {
    const res = await axios.post('http://127.0.0.1:5001/api/auth/verify-key', {
      adminKey: 'admin123'
    });
    console.log('VERIFY KEY SUCCESS:', res.status, res.data);
  } catch (err) {
    console.log('VERIFY KEY ERROR:', err.response?.status, err.response?.data, err.message);
  }
}

run();
