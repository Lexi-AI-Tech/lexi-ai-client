/**
 * Lexi AI Landing Page Scripts
 * Handles animations, interactions, and scroll effects
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initNavbarScroll();
  initSmoothScroll();
  initTypingAnimation();
  initParallaxOrbs();
});

/**
 * Scroll-triggered animations using Intersection Observer
 */
function initScrollAnimations() {
  // Add animate-on-scroll class to elements we want to animate
  const animatedElements = document.querySelectorAll(
    '.feature-card, .step, .language-pill, .section-header'
  );
  
  animatedElements.forEach((el, index) => {
    el.classList.add('animate-on-scroll');
    el.style.transitionDelay = `${index * 50}ms`;
  });

  // Create intersection observer
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    {
      root: null,
      rootMargin: '0px',
      threshold: 0.1,
    }
  );

  // Observe all animated elements
  document.querySelectorAll('.animate-on-scroll').forEach((el) => {
    observer.observe(el);
  });
}

/**
 * Navbar effects on scroll
 */
function initNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  const navContainer = document.querySelector('.nav-container');
  
  if (!navbar || !navContainer) return;

  let lastScroll = 0;
  let ticking = false;

  window.addEventListener('scroll', () => {
    lastScroll = window.scrollY;

    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateNavbar(lastScroll);
        ticking = false;
      });
      ticking = true;
    }
  });

  function updateNavbar(scrollPos) {
    if (scrollPos > 50) {
      navbar.classList.add('scrolled');
      navContainer.style.background = 'rgba(255, 255, 255, 0.95)';
      navContainer.style.backdropFilter = 'blur(20px)';
      navContainer.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
    } else {
      navbar.classList.remove('scrolled');
      navContainer.style.background = 'rgba(255, 255, 255, 1)';
      navContainer.style.backdropFilter = 'none';
      navContainer.style.boxShadow = '0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)';
    }
  }
}

/**
 * Smooth scroll for anchor links
 */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const targetId = this.getAttribute('href');
      
      if (targetId === '#') return;
      
      const targetElement = document.querySelector(targetId);
      
      if (targetElement) {
        const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 80;
        const targetPosition = targetElement.getBoundingClientRect().top + window.scrollY - navbarHeight;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth',
        });
      }
    });
  });
}

/**
 * Typing animation for the "How it Works" section
 */
function initTypingAnimation() {
  const typedTextElement = document.querySelector('.typed-text');
  
  if (!typedTextElement) return;

  const phrases = [
    'Hello world!',
    'Meeting at 3pm',
    'Great idea! ✨',
    'Send the report',
    'Call me back',
  ];

  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let isPaused = false;

  function type() {
    const currentPhrase = phrases[phraseIndex];
    
    if (isPaused) {
      setTimeout(type, 1500);
      isPaused = false;
      isDeleting = true;
      return;
    }

    if (isDeleting) {
      typedTextElement.textContent = currentPhrase.substring(0, charIndex - 1);
      charIndex--;
      
      if (charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        setTimeout(type, 500);
        return;
      }
    } else {
      typedTextElement.textContent = currentPhrase.substring(0, charIndex + 1);
      charIndex++;
      
      if (charIndex === currentPhrase.length) {
        isPaused = true;
      }
    }

    const typingSpeed = isDeleting ? 50 : 100;
    setTimeout(type, typingSpeed);
  }

  // Start typing animation with a delay
  setTimeout(type, 2000);
}

/**
 * Parallax effect for background orbs
 */
function initParallaxOrbs() {
  const orbs = document.querySelectorAll('.orb');
  
  if (orbs.length === 0) return;

  let mouseX = 0;
  let mouseY = 0;
  let currentX = 0;
  let currentY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function animate() {
    // Smooth interpolation
    currentX += (mouseX - currentX) * 0.02;
    currentY += (mouseY - currentY) * 0.02;

    orbs.forEach((orb, index) => {
      const speed = (index + 1) * 15;
      const x = currentX * speed;
      const y = currentY * speed;
      orb.style.transform = `translate(${x}px, ${y}px)`;
    });

    requestAnimationFrame(animate);
  }

  animate();
}

/**
 * Button hover effect with ripple
 */
document.querySelectorAll('.btn').forEach((button) => {
  button.addEventListener('mouseenter', function (e) {
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    this.style.setProperty('--ripple-x', `${x}px`);
    this.style.setProperty('--ripple-y', `${y}px`);
  });
});

/**
 * Feature cards tilt effect
 */
document.querySelectorAll('.feature-card').forEach((card) => {
  card.addEventListener('mousemove', function (e) {
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = (y - centerY) / 20;
    const rotateY = (centerX - x) / 20;
    
    this.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
  });
  
  card.addEventListener('mouseleave', function () {
    this.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)';
  });
});

/**
 * Preloader (optional - can be removed if not needed)
 */
window.addEventListener('load', () => {
  document.body.classList.add('loaded');
});

/**
 * Keyboard navigation accessibility
 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    document.body.classList.add('keyboard-navigation');
  }
});

document.addEventListener('mousedown', () => {
  document.body.classList.remove('keyboard-navigation');
});

/**
 * Lazy load images (for future use)
 */
function initLazyLoading() {
  const lazyImages = document.querySelectorAll('img[data-src]');
  
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.classList.add('loaded');
          imageObserver.unobserve(img);
        }
      });
    });

    lazyImages.forEach((img) => imageObserver.observe(img));
  }
}

/**
 * Analytics event tracking (placeholder)
 */
function trackEvent(category, action, label) {
  // Add your analytics tracking code here
  console.log(`Event: ${category} - ${action} - ${label}`);
}

// Track CTA clicks
document.querySelectorAll('.btn').forEach((btn) => {
  btn.addEventListener('click', function () {
    const label = this.textContent.trim();
    trackEvent('CTA', 'click', label);
  });
});

console.log('🎤 Lexi AI - Website loaded successfully');

