import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.EMAIL_PASS);

export const sendEmail = async (to, subject, html) => {
  const msg = {
    to,
    from: process.env.EMAIL_FROM, // verified email
    subject,
    html,
  };

  await sgMail.send(msg);
};
// import { BrevoClient } from '@getbrevo/brevo';

// const brevo = new BrevoClient({
//   apiKey: process.env.BREVO_API_KEY,
// });

// export const sendEmail = async (to, subject, htmlContent) => {
//   try {
//     const result = await brevo.transactionalEmails.sendTransacEmail({
//       to: [{ email: to }],
//       sender: {
//         name: process.env.BREVO_SENDER_NAME,
//         email: process.env.BREVO_SENDER_EMAIL
//       },
//       subject: subject,
//       htmlContent: htmlContent
//     });

//     console.log(" Email Sent:", result.messageId);
//   } catch (error) {
//     console.error(" Brevo Error:", error);
//     throw error;
//   }
// };