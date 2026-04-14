

// ── IMAGE PATHS ──
// Replace these with your actual image URLs or file paths
const IMG_HERO  = 'inages/7136d55f-f74e-49c7-9101-61a9be6854e8.jpg';
const IMG_WORK1 = 'inages/image2.jpg';
const IMG_WORK2 = 'inages/image.jpg';
const IMG_WORK3 = 'inages/Mar 30, 2026, 05_35_20 PM.png';
const IMG_WORK4 = 'inages/Imag55.png';

// ── SET IMAGES ──
if (IMG_HERO) {
  document.getElementById('heroBg').style.backgroundImage = `url(${IMG_HERO})`;
}
document.getElementById('workImg1').src = IMG_WORK1;
document.getElementById('workImg2').src = IMG_WORK2;
document.getElementById('workImg3').src = IMG_WORK3;
document.getElementById('workImg4').src = IMG_WORK4;

// ── NAV SCROLL SHADOW ──
window.addEventListener('scroll', function () {
  document.getElementById('nav').classList.toggle('scrolled', window.scrollY > 40);
});

// ── HAMBURGER MENU ──
const ham = document.getElementById('ham');
const mob = document.getElementById('mob');

ham.addEventListener('click', function () {
  ham.classList.toggle('open');
  mob.classList.toggle('open');
});

function closeMob() {
  ham.classList.remove('open');
  mob.classList.remove('open');
}

// ── VIDEO ──
// Video is embedded directly in the HTML as inages/0319.mp4

// ── FAQ ACCORDION ──
const faqs = [
  {
    q: 'How do I get a quote?',
    a: 'Just fill out the form on this page or call/text us directly at (239) 246-5837. We typically respond within the hour with a flat, no-surprise price.'
  },
  {
    q: 'Do you transport non-running vehicles?',
    a: "Yes. We have the right equipment to safely load and haul vehicles that won't start or can't be driven. Just let us know upfront when you request your quote."
  },
  {
    q: 'What is scheduled equipment hauling?',
    a: "Scheduled hauling lets you book a specific date and time in advance — ideal for contractors, construction crews, or businesses that need equipment moved on a set timeline. We confirm your appointment and show up ready to go."
  },
  {
    q: 'What areas do you serve?',
    a: "We're based in North Carolina and cover the entire state. We also handle interstate and long-distance transport — just ask and we'll let you know if we can reach your destination."
  },
  {
    q: 'Are there any hidden fees?',
    a: 'Never. The price we quote you is the price you pay. No fuel surcharges, no last-minute add-ons, no surprises at delivery.'
  },
  {
    q: 'Are you licensed and insured?',
    a: 'Yes. RS on the Go LLC is fully DOT-licensed and carries comprehensive liability insurance. Your vehicle or cargo is protected from pickup to drop-off.'
  },
  {
    q: 'Can you do same-day or emergency pickups?',
    a: "Absolutely. We're available 24/7 including nights, weekends, and holidays. If you need an emergency or same-day pickup, call us directly for the fastest response."
  }
];

const faqList = document.getElementById('faqList');

/**
 * Open a single FAQ item with pixel-accurate height animation.
 * Uses the inner element's scrollHeight so the transition is smooth
 * regardless of content length — no more max-height hack artifacts.
 */
function openFaq(item) {
  const panel = item.querySelector('.faq-a');
  const inner = item.querySelector('.faq-a-inner');
  item.classList.add('open');
  // Set explicit height to scrollHeight so CSS transition fires
  panel.style.height = inner.scrollHeight + 'px';
}

function closeFaq(item) {
  const panel = item.querySelector('.faq-a');
  // Snap from auto to explicit px before collapsing
  panel.style.height = panel.scrollHeight + 'px';
  // Force reflow so the browser registers the starting value
  panel.getBoundingClientRect();
  panel.style.height = '0';
  item.classList.remove('open');
}

faqs.forEach(function (f) {
  const item = document.createElement('div');
  item.className = 'faq-item';
  item.innerHTML = `
    <button class="faq-q" aria-expanded="false">
      ${f.q}
      <div class="faq-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <!-- horizontal bar -->
          <line class="icon-h" x1="5" y1="12" x2="19" y2="12"/>
          <!-- vertical bar -->
          <line class="icon-v" x1="12" y1="5" x2="12" y2="19"/>
        </svg>
      </div>
    </button>
    <div class="faq-a" role="region">
      <div class="faq-a-inner">
        <p>${f.a}</p>
      </div>
    </div>
  `;

  const btn = item.querySelector('.faq-q');

  btn.addEventListener('click', function () {
    const isOpen = item.classList.contains('open');

    // Close all other open items
    document.querySelectorAll('.faq-item.open').forEach(function (el) {
      if (el !== item) {
        closeFaq(el);
        el.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      }
    });

    if (isOpen) {
      closeFaq(item);
      btn.setAttribute('aria-expanded', 'false');
    } else {
      openFaq(item);
      btn.setAttribute('aria-expanded', 'true');
    }
  });

  faqList.appendChild(item);
});

// ── CONTACT FORM SUBMIT ──
document.getElementById('fsbtn').addEventListener('click', function (e) {
  e.preventDefault();
  this.innerHTML = "✓ Message Sent — We'll be in touch shortly!";
  this.style.background = '#16a34a';
  this.disabled = true;
});
