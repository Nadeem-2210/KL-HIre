const nodemailer = require('nodemailer');

// Setup mail transporter
const createTransporter = async () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    console.log(`✉️ Mailer initialized with SMTP configuration: ${host}:${port}`);
    return nodemailer.createTransport({
      host,
      port: parseInt(port, 10),
      secure: parseInt(port, 10) === 465,
      auth: { user, pass }
    });
  }

  // Fallback: Ethereal test account or local logging
  console.log('✉️ No production SMTP configuration found. Using mock/Ethereal transport for testing.');
  try {
    const testAccount = await nodemailer.createTestAccount();
    console.log(`✉️ Ethereal SMTP account created: ${testAccount.user}`);
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
  } catch (err) {
    console.warn('⚠️ Failed to initialize Ethereal SMTP, creating a console-only transport.');
    return {
      sendMail: async (mailOptions) => {
        console.log('\n==================================================');
        console.log('✉️ MOCK EMAIL SENT (Console Logger Fallback)');
        console.log(`FROM: ${mailOptions.from}`);
        console.log(`TO: ${mailOptions.to}`);
        console.log(`SUBJECT: ${mailOptions.subject}`);
        console.log('--------------------------------------------------');
        console.log(mailOptions.text);
        console.log('==================================================\n');
        return { messageId: 'console-mock-id' };
      }
    };
  }
};

let transporterPromise = createTransporter();

/**
 * Send trainee onboarding credentials email.
 */
const sendOnboardingEmail = async (email, name, tempPassword) => {
  const transporter = await transporterPromise;
  
  const portalLink = process.env.FRONTEND_URL || 'http://localhost:5174';
  const loginLink = `${portalLink}/login`;

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Inter, sans-serif; background-color: #f7f6f2; padding: 40px; color: #0f172a; max-width: 600px; margin: 0 auto; border-radius: 12px; border: 1px solid #e0ded6;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 40px;">🎯</span>
        <h1 style="font-size: 24px; font-weight: 800; margin: 8px 0 0; color: #2563eb;">KL-Hire Onboarding</h1>
        <p style="color: #64748b; font-size: 14px; margin: 4px 0 0;">Welcome to the team</p>
      </div>

      <div style="background-color: #ffffff; border-radius: 8px; padding: 24px; border: 1px solid #e0ded6; box-shadow: 0 4px 12px rgba(0,0,0,0.025);">
        <p style="font-size: 16px; margin: 0 0 16px; font-weight: 600;">Hello ${name},</p>
        <p style="font-size: 14px; color: #334155; line-height: 1.6; margin: 0 0 20px;">
          Congratulations! Your candidate/trainee account on the KL-Hire platform has been <strong>approved</strong> by the administrator. 
          Your temporary account credentials have been generated and assigned below.
        </p>

        <div style="background-color: #f0eee6; border-radius: 6px; padding: 16px; margin-bottom: 24px; border: 1px solid #e0ded6;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 4px 0; font-weight: 600; color: #64748b; width: 140px;">Assigned Email:</td>
              <td style="padding: 4px 0; font-weight: 700; color: #0f172a; font-family: monospace;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: 600; color: #64748b;">Temp Password:</td>
              <td style="padding: 4px 0; font-weight: 700; color: #dc2626; font-family: monospace; font-size: 16px;">${tempPassword}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin-bottom: 20px;">
          <a href="${loginLink}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px; font-size: 14px; box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
            Access Login Portal
          </a>
        </div>

        <p style="font-size: 12px; color: #ea580c; background-color: #fff7ed; border: 1px solid #ffedd5; padding: 10px; border-radius: 6px; margin: 0; line-height: 1.5;">
          ⚠️ <strong>Security Notice:</strong> This temporary password is valid for 24 hours only. Please use it to access the platform.
        </p>
      </div>

      <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #64748b;">
        <p style="margin: 0;">KL-Hire Assessment & Onboarding Platform</p>
      </div>
    </div>
  `;

  const textContent = `
    Hello ${name},

    Congratulations! Your trainee account on the KL-Hire platform has been approved.

    Your temporary credentials are:
    Assigned Email: ${email}
    Temporary Password: ${tempPassword}

    Please log in at: ${loginLink}

    Note: This temporary password is valid for 24 hours only. Please use it to access the platform.
  `;

  // Always log the credentials to the console for easier developer verification
  console.log('\n==================================================');
  console.log(`🔑 ONBOARDING CREDENTIALS GENERATED FOR: ${name}`);
  console.log(`📧 Email: ${email}`);
  console.log(`🔑 Temporary Password: ${tempPassword}`);
  console.log(`🌐 Link: ${loginLink}`);
  console.log('==================================================\n');

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || '"KL-Hire Admin" <noreply@klhire.local>',
      to: email,
      subject: 'KL-Hire Account Approved - Temporary Credentials',
      text: textContent,
      html: htmlContent
    });
    console.log(`✉️ Onboarding email sent successfully: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error('❌ Failed to send onboarding email via transporter:', err);
    throw err;
  }
};

module.exports = { sendOnboardingEmail };
