const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isContactEmail, extractContactEmailsFromHtml } = require('./contact-email');

test('rejects observed technical, placeholder and malformed contacts', () => {
  for (const email of ['abc@o363271.ingest.us.sentry.io', 'abc@sentry.io', 'abc@sentry-next.wixpress.com', 'abc@sentry.wixpress.com', 'user@domain.com', 'your-email@example.com', 'example@mysite.com', 'sweetalert2@8.min.js', 'logo@2x.png', 'bookstass@gmail.comlinktr.ee', 'skbeats512@gmail.composting', 'inrvry.mgmt@gmail.comepk', 'support@votiveatx.bandcamp.com', 'a@b.com\nb@c.com']) {
    assert.equal(isContactEmail(email), false, email);
  }
});

test('preserves artist and booking emails on varied domains', () => {
  for (const email of ['artist+booking@gmail.com', 'paul.ryan@the.team', 'booking@greysonturner.music', 'remco@disk-agency.de', 'support@artist.com']) assert.equal(isContactEmail(email), true, email);
});

test('extracts visible text and mailto, excluding source-code contacts and assets', () => {
  assert.deepEqual(extractContactEmailsFromHtml(`<script>"staff@vendor.com"</script><style>/* dev@vendor.com */</style><!-- hidden@vendor.com --><img src="logo@2x.png"><p>Artist@Gmail.com</p><p>EPK</p><a href="mailto:booking%2Bshows%40artist.com?subject=test&cc=other@vendor.com">Contact</a><p>abc@sentry.io</p>`), ['booking+shows@artist.com', 'artist@gmail.com']);
});

test('SMTP refuses invalid recipients without creating transport or sending', async () => {
  const nodemailer = require('nodemailer');
  const original = nodemailer.createTransport;
  nodemailer.createTransport = () => { throw new Error('Transport must not be created'); };
  try {
    const { sendEmail } = require('./email-sender');
    await assert.rejects(sendEmail('abc@sentry.io', 'Subject', 'Body'), /not a usable contact email/);
  } finally { nodemailer.createTransport = original; }
});
