const axios = require('axios');
async function run() {
  try {
    const res = await axios.get('https://www.google.com');
    console.log('Google connection success:', res.status);
  } catch (err) {
    console.error('Google connection failed:', err.message);
  }
}
run();
