import { MESSAGES } from './policy.js';

export default function ConsentNotice() {
  return (
    <section className="consent-notice" aria-labelledby="consent-title">
      <h2 id="consent-title">Exam monitoring notice</h2>
      <p>{MESSAGES.banner}</p>
      <p>
        We record browser events such as tab changes, fullscreen exits and copy/paste attempts. We never record what you copy, your
        passwords or personal data. Events are signals for human review, not proof of any wrongdoing. If you use assistive technology,
        ask your exam administrator to enable accessibility mode.
      </p>
    </section>
  );
}
