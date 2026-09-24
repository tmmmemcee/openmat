import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * SMTP when SMTP_URL is set (e.g. smtps://user:pass@smtp.example.com:465),
 * otherwise emails are printed to the server log so development works
 * without an email account.
 */
export function createMailer(log: (msg: string) => void = console.log): Mailer {
  const url = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM ?? "OpenMat <no-reply@openmat.local>";
  if (!url) {
    return {
      async send(mail) {
        log(`\n--- email (not sent: SMTP_URL isn't set) ---\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n---\n`);
      },
    };
  }
  const transport = nodemailer.createTransport(url);
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}

/** Collects emails instead of sending them (tests). */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
    },
  };
}
