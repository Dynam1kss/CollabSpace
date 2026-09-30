import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../env';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

// у тестах нікуди не шлемо — лист лягає сюди, звідти тест дістає посилання
export const sentMails: Mail[] = [];

let transport: Transporter | null = null;

// один транспорт на процес: nodemailer тримає пул зʼєднань сам, а перескладати
// його на кожен лист означало б новий конект до smtp щоразу
function getTransport() {
  if (!env.smtpHost) return null;
  transport ??= createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    // maildev і локальні перехоплювачі без tls взагалі; 465 — той єдиний порт,
    // де tls починається одразу, на 587 його піднімає вже STARTTLS
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
  });
  return transport;
}

// лист не мусить валити запит: користувачу однаково відповідаємо те саме,
// а причину видно в логах
export async function sendMail(mail: Mail) {
  if (process.env.NODE_ENV === 'test') {
    sentMails.push(mail);
    return;
  }
  const smtp = getTransport();
  if (!smtp) {
    // без smtp у розробці лист писати нікуди — кладемо в консоль, щоб
    // посилання все одно можна було відкрити
    console.info(`[mail] ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  try {
    await smtp.sendMail({ from: env.smtpFrom, ...mail });
  } catch (err) {
    console.error('[mail] не відправлено', err);
  }
}
