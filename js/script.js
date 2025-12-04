// Notification System
function showNotification(title, message, type = 'info', duration = 4000, hideClose = false) {
  const container = document.getElementById('notificationContainer');
  if (!container) return;

  const icons = {
    success: '✅',
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌'
  };

  const notif = document.createElement('div');
  notif.className = `notification ${type}${hideClose ? ' no-close' : ''}`;
  notif.innerHTML = `
    <span class="notification-icon">${icons[type] || icons.info}</span>
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    </div>
    ${hideClose ? '' : '<span class="notification-close">&times;</span>'}
  `;

  const close = () => {
    notif.classList.add('fade-out');
    setTimeout(() => notif.remove(), 300);
  };

  if (!hideClose) {
    const closeBtn = notif.querySelector('.notification-close');
    if (closeBtn) closeBtn.onclick = close;
  }
  container.appendChild(notif);

  if (duration > 0) {
    setTimeout(close, duration);
  }
}

const safeSetItem = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`Failed to write ${key} to storage`, error);
    if (typeof showNotification === 'function') {
      showNotification("Storage Full", "Browser storage is full. Please delete old bikes/images from the admin panel or clear site data.", "error", 6000, true);
    } else {
      alert("Browser storage is full. Please delete stored data.");
    }
    return false;
  }
};

const safeSetJSON = (key, data) => safeSetItem(key, JSON.stringify(data));

// Helper to get currentUser from localStorage or sessionStorage (fallback)
const getCurrentUser = () => {
  try {
    const user = localStorage.getItem("currentUser");
    if (user) return JSON.parse(user);
  } catch {}
  try {
    const user = sessionStorage.getItem("currentUser");
    if (user) return JSON.parse(user);
  } catch {}
  return null;
};

// Helper to set currentUser, tries localStorage first, falls back to sessionStorage
const setCurrentUser = (user) => {
  if (safeSetJSON("currentUser", user)) {
    return true;
  }
  // Fallback to sessionStorage if localStorage fails
  try {
    sessionStorage.setItem("currentUser", JSON.stringify(user));
    return true;
  } catch {
    return false;
  }
};

const DIRECT_MESSAGES_KEY = 'directMessages';
const escapeHTML = (str = '') => String(str).replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[ch] || ch));

const buildChatKey = (emailA = '', emailB = '') => {
  return [String(emailA).toLowerCase(), String(emailB).toLowerCase()].sort().join('__');
};

const getChatHistory = (emailA, emailB) => {
  try {
    const all = JSON.parse(localStorage.getItem(DIRECT_MESSAGES_KEY) || '{}');
    const key = buildChatKey(emailA, emailB);
    return Array.isArray(all[key]) ? all[key] : [];
  } catch {
    return [];
  }
};

const appendChatMessage = (emailA, emailB, message) => {
  try {
    const all = JSON.parse(localStorage.getItem(DIRECT_MESSAGES_KEY) || '{}');
    const key = buildChatKey(emailA, emailB);
    if (!Array.isArray(all[key])) all[key] = [];
    all[key].push(message);
    safeSetJSON(DIRECT_MESSAGES_KEY, all);
  } catch {
    safeSetJSON(DIRECT_MESSAGES_KEY, {
      [buildChatKey(emailA, emailB)]: [message]
    });
  }
};

const getChatThreadsForUser = (email) => {
  const lowerEmail = String(email || '').toLowerCase();
  if (!lowerEmail) return [];
  let allMessages = {};
  try {
    allMessages = JSON.parse(localStorage.getItem(DIRECT_MESSAGES_KEY) || '{}');
  } catch {
    allMessages = {};
  }
  const users = JSON.parse(localStorage.getItem('users') || '[]');
  const usersMap = users.reduce((acc, user) => {
    if (user.email) acc[String(user.email).toLowerCase()] = user;
    return acc;
  }, {});
  const threads = [];
  Object.entries(allMessages).forEach(([key, msgs]) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return;
    const participants = key.split('__');
    if (!participants.includes(lowerEmail)) return;
    const other = participants[0] === lowerEmail ? participants[1] : participants[0];
    const otherUser = usersMap[other] || {};
    const lastMessage = msgs[msgs.length - 1];
    threads.push({
      otherEmail: other,
      otherName: otherUser.name || other,
      avatar: otherUser.profilePicUrl || '',
      lastMessage,
      lastTimestamp: lastMessage.timestamp || lastMessage.id || 0
    });
  });
  return threads.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
};

const compressImageFile = (file, maxSize = 800, quality = 0.7) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const originalData = event.target.result;
      const img = new Image();
      img.onload = () => {
        const largestSide = Math.max(img.width, img.height);
        const scale = largestSide > maxSize ? maxSize / largestSide : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let compressed;
        try {
          compressed = canvas.toDataURL('image/jpeg', quality);
          // If compressed image is still too large (>500KB), compress more aggressively
          if (compressed.length > 500000) {
            const newQuality = Math.max(0.5, quality - 0.1);
            compressed = canvas.toDataURL('image/jpeg', newQuality);
          }
        } catch (err) {
          console.error('Failed to compress image, using original', err);
          resolve(originalData);
          return;
        }
        resolve(compressed.length < originalData.length ? compressed : originalData);
      };
      img.onerror = () => resolve(originalData);
      img.src = originalData;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
};

// Check storage quota and estimate usage
const checkStorageQuota = () => {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      return navigator.storage.estimate().then(estimate => ({
        quota: estimate.quota,
        usage: estimate.usage,
        usageDetails: estimate.usageDetails
      }));
    }
    // Fallback: estimate from localStorage
    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length + key.length;
      }
    }
    return Promise.resolve({
      quota: 5 * 1024 * 1024, // Assume 5MB default
      usage: total * 2, // Rough estimate (UTF-16 encoding)
      usageDetails: null
    });
  } catch (e) {
    console.error('Storage quota check failed', e);
    return Promise.resolve({ quota: 5 * 1024 * 1024, usage: 0, usageDetails: null });
  }
};

// Aggressive cleanup to free storage space
const cleanupStorage = (aggressive = false) => {
  try {
    const bikes = JSON.parse(localStorage.getItem("bikes") || "[]");
    const rentals = JSON.parse(localStorage.getItem("rentals") || "[]");
    const users = JSON.parse(localStorage.getItem("users") || "[]");
    const routes = JSON.parse(localStorage.getItem("routes") || "[]");
    const existingEmails = new Set(users.map(u => (u.email || "").toLowerCase()));
    
    let cleaned = false;
    
    // 1. Remove bikes from deleted users
    const cleanedBikes = bikes.filter(b => existingEmails.has((b.owner || "").toLowerCase()));
    
    // 2. Remove ALL completed rentals (not just old ones) if aggressive cleanup
    const cleanedRentals = aggressive 
      ? rentals.filter(r => r.status !== 'Completed')
      : rentals.filter(r => {
          if (r.status === 'Completed') {
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            return r.endTime && r.endTime > sevenDaysAgo;
          }
          return true;
        });
    
    // 3. Remove old bikes without images or very old bikes if aggressive
    let finalBikes = cleanedBikes;
    if (aggressive) {
      const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
      finalBikes = cleanedBikes.filter(b => {
        // Keep bikes with images or recent bikes
        const hasImages = (b.imageUrls && b.imageUrls.length > 0) || b.imageUrl;
        const isRecent = b.id && b.id > oneYearAgo;
        return hasImages || isRecent;
      });
    }
    
    // 4. Compress images in remaining bikes to reduce size
    const compressedBikes = finalBikes.map(bike => {
      if (!bike.imageUrls && !bike.imageUrl) return bike;
      
      const images = bike.imageUrls || (bike.imageUrl ? [bike.imageUrl] : []);
      const compressedImages = images.map(img => {
        if (!img || img.length < 200000) return img; // Skip if already small
        
        // Try to reduce image size by creating a smaller version
        return new Promise(resolve => {
          const imgEl = new Image();
          imgEl.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 600;
            const scale = Math.max(imgEl.width, imgEl.height) > maxSize 
              ? maxSize / Math.max(imgEl.width, imgEl.height) 
              : 1;
            canvas.width = Math.round(imgEl.width * scale);
            canvas.height = Math.round(imgEl.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
            try {
              const compressed = canvas.toDataURL('image/jpeg', 0.6);
              resolve(compressed.length < img.length ? compressed : img);
            } catch {
              resolve(img);
            }
          };
          imgEl.onerror = () => resolve(img);
          imgEl.src = img;
        });
      });
      
      // For now, return bike as-is (async compression would be complex)
      return bike;
    });
    
    // 5. Remove old routes if aggressive
    const cleanedRoutes = aggressive 
      ? routes.filter(r => {
          const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
          return r.createdAt && r.createdAt > oneMonthAgo;
        })
      : routes;
    
    // 6. Remove old chat messages and notifications
    const chatKeys = Object.keys(localStorage).filter(k => k.startsWith('chat_'));
    const notificationKeys = Object.keys(localStorage).filter(k => k.startsWith('seenNotifications_'));
    
    if (aggressive) {
      // Remove all old chat and notifications
      chatKeys.forEach(k => {
        try {
          const chatData = JSON.parse(localStorage.getItem(k) || '[]');
          if (Array.isArray(chatData) && chatData.length > 50) {
            // Keep only last 50 messages
            const recent = chatData.slice(-50);
            localStorage.setItem(k, JSON.stringify(recent));
            cleaned = true;
          }
        } catch {}
      });
      
      notificationKeys.forEach(k => {
        try {
          const notifData = JSON.parse(localStorage.getItem(k) || '[]');
          if (Array.isArray(notifData) && notifData.length > 20) {
            const recent = notifData.slice(-20);
            localStorage.setItem(k, JSON.stringify(recent));
            cleaned = true;
          }
        } catch {}
      });
    }
    
    // Save cleaned data
    if (cleanedBikes.length < bikes.length || finalBikes.length < cleanedBikes.length) {
      if (safeSetJSON("bikes", finalBikes)) cleaned = true;
    }
    if (cleanedRentals.length < rentals.length) {
      if (safeSetJSON("rentals", cleanedRentals)) cleaned = true;
    }
    if (cleanedRoutes.length < routes.length) {
      if (safeSetJSON("routes", cleanedRoutes)) cleaned = true;
    }
    
    return cleaned;
  } catch (e) {
    console.error('Storage cleanup failed', e);
    return false;
  }
};

// Emergency cleanup - removes as much as possible
const emergencyCleanup = () => {
  try {
    // Remove all completed rentals
    const rentals = JSON.parse(localStorage.getItem("rentals") || "[]");
    const activeRentals = rentals.filter(r => r.status !== 'Completed');
    safeSetJSON("rentals", activeRentals);
    
    // Remove old routes
    const routes = JSON.parse(localStorage.getItem("routes") || "[]");
    const recentRoutes = routes.slice(-20); // Keep only last 20 routes
    safeSetJSON("routes", recentRoutes);
    
    // Remove old chat messages
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('chat_')) {
        try {
          const chatData = JSON.parse(localStorage.getItem(k) || '[]');
          if (Array.isArray(chatData) && chatData.length > 20) {
            localStorage.setItem(k, JSON.stringify(chatData.slice(-20)));
          }
        } catch {}
      }
    });
    
    // Remove old notifications
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('seenNotifications_')) {
        try {
          const notifData = JSON.parse(localStorage.getItem(k) || '[]');
          if (Array.isArray(notifData) && notifData.length > 10) {
            localStorage.setItem(k, JSON.stringify(notifData.slice(-10)));
          }
        } catch {}
      }
    });
    
    return true;
  } catch (e) {
    console.error('Emergency cleanup failed', e);
    return false;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const ADMIN_EMAIL = "admin@cychris.com";
  const DEFAULT_ADMIN = { id: 1, name: "Admin", email: ADMIN_EMAIL, password: "admin123", role: "admin", status: "approved" };
  // Get currentUser from localStorage or sessionStorage (fallback)
  let currentUser = getCurrentUser();
  const loginLink = document.getElementById("loginLink");
  const logoutLink = document.getElementById("logoutLink");
  const adminLink = document.getElementById("adminLink");
  const profileLink = document.getElementById("profileLink");
  const siteHeader = document.querySelector("header");
  const ensureGlobalImageViewer = () => {
    let modal = document.getElementById('imageViewerModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'imageViewerModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:90vw;max-height:90vh;padding:0;">
          <span id="imageViewerClose" class="modal-close">&times;</span>
          <img id="viewerImage" src="" alt="Preview" style="width:100%;max-height:85vh;object-fit:contain;border-radius:var(--radius-lg);">
        </div>
      `;
      document.body.appendChild(modal);
    }
    const closeBtn = document.getElementById('imageViewerClose');
    const viewerImage = document.getElementById('viewerImage');
    closeBtn?.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    return { modal, viewerImage };
  };

  const { modal: globalImageViewer, viewerImage } = ensureGlobalImageViewer();

  const openGlobalImageViewer = (src) => {
    if (!src || !viewerImage || !globalImageViewer) return;
    viewerImage.src = src;
    globalImageViewer.style.display = 'flex';
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-viewer-src]');
    if (!trigger) return;
    const src = trigger.getAttribute('data-viewer-src') || trigger.getAttribute('src');
    if (!src) return;
    event.preventDefault();
    openGlobalImageViewer(src);
  });

  const aboutMeCard = document.getElementById('aboutMeCard');
  const aboutMeModal = document.getElementById('aboutMeModal');
  const aboutMeClose = document.getElementById('aboutMeClose');
  if (aboutMeCard && aboutMeModal) {
    const openAboutModal = () => {
      aboutMeModal.style.display = 'flex';
    };
    const closeAboutModal = () => {
      aboutMeModal.style.display = 'none';
    };
    aboutMeCard.addEventListener('click', openAboutModal);
    aboutMeCard.addEventListener('keypress', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAboutModal();
      }
    });
    aboutMeClose?.addEventListener('click', closeAboutModal);
    aboutMeModal.addEventListener('click', (event) => {
      if (event.target === aboutMeModal) closeAboutModal();
    });
  }

  const updateChatNavBadge = (threadsOverride) => {
    if (!profileLink || !currentUser || !currentUser.email) return;
    const myEmailLower = currentUser.email.toLowerCase();
    const threads = threadsOverride || getChatThreadsForUser(currentUser.email);
    const unreadCount = threads.filter(t => {
      const last = t.lastMessage;
      if (!last || !last.sender) return false;
      if (last.sender.toLowerCase() === myEmailLower) return false;
      const seenBy = Array.isArray(last.seenBy) ? last.seenBy : [];
      return !seenBy.includes(currentUser.email);
    }).length;
    let badge = profileLink.querySelector('.chat-nav-badge');
    if (unreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chat-nav-badge';
        profileLink.appendChild(badge);
      }
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.title = `${unreadCount} unread chat${unreadCount === 1 ? '' : 's'}`;
    } else if (badge) {
      badge.remove();
    }
  };

  const updateHeaderState = () => {
    if (!siteHeader) return;
    if (window.scrollY > 20) {
      siteHeader.classList.add("header-scrolled");
    } else {
      siteHeader.classList.remove("header-scrolled");
    }
  };

  const setupNavToggle = () => {
    const toggles = document.querySelectorAll('.nav-toggle');
    toggles.forEach(btn => {
      const nav = btn.nextElementSibling && btn.nextElementSibling.tagName === 'NAV' ? btn.nextElementSibling : null;
      if (!nav) return;
      const closeNav = () => {
        nav.classList.remove('nav-open');
        btn.classList.remove('nav-open');
        btn.setAttribute('aria-expanded', 'false');
      };
      btn.addEventListener('click', () => {
        const willOpen = !nav.classList.contains('nav-open');
        if (willOpen) {
          nav.classList.add('nav-open');
          btn.classList.add('nav-open');
          btn.setAttribute('aria-expanded', 'true');
        } else {
          closeNav();
        }
      });
      nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', closeNav);
      });
      window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
          closeNav();
        }
      });
    });
  };

  setupNavToggle();

  if (siteHeader) {
    const heroSection = document.querySelector(".hero");
    if (heroSection) {
      updateHeaderState();
      window.addEventListener("scroll", updateHeaderState, { passive: true });
    } else {
      siteHeader.classList.add("header-scrolled");
    }
  }

  // Initialize data
  // Ensure users array exists and always contains the default admin
  let usersInit;
  let usersModified = false;
  try {
    usersInit = JSON.parse(localStorage.getItem("users") || "[]");
    if (!Array.isArray(usersInit)) usersInit = [];
  } catch (_) {
    usersInit = [];
  }
  usersInit = usersInit.map(user => {
    if (!user.status) {
      usersModified = true;
      return { ...user, status: "approved" };
    }
    return user;
  });
  const adminIndex = usersInit.findIndex(u => (u.email || "").toLowerCase() === ADMIN_EMAIL);
  if (adminIndex === -1) {
    usersInit.push({ ...DEFAULT_ADMIN });
    usersModified = true;
  } else {
    const existingAdmin = usersInit[adminIndex] || {};
    const needsRoleFix = existingAdmin.role !== "admin";
    const needsPassword = !existingAdmin.password;
    if (needsRoleFix || needsPassword) {
      usersInit[adminIndex] = {
        ...existingAdmin,
        ...DEFAULT_ADMIN,
        password: existingAdmin.password || DEFAULT_ADMIN.password
      };
      usersModified = true;
    }
  }
  if (!localStorage.getItem("users")) {
    usersModified = true;
  }
  if (usersModified) {
    safeSetJSON("users", usersInit);
  }
  // Clean orphaned bikes/rentals (e.g., posted by deleted users)
  const existingEmails = new Set(usersInit.map(u => (u.email || "").toLowerCase()));
  const bikesInit = JSON.parse(localStorage.getItem("bikes") || "[]");
  const cleanedBikes = bikesInit.filter(b => existingEmails.has((b.owner || "").toLowerCase()));
  if (cleanedBikes.length !== bikesInit.length) {
    safeSetJSON("bikes", cleanedBikes);
  }
  const validBikeIds = new Set(cleanedBikes.map(b => String(b.id)));
  const rentalsInit = JSON.parse(localStorage.getItem("rentals") || "[]");
  const cleanedRentals = rentalsInit.filter(r => {
    const renterEmail = (r.renter || "").toLowerCase();
    return validBikeIds.has(String(r.bikeId)) && existingEmails.has(renterEmail);
  });
  if (cleanedRentals.length !== rentalsInit.length) {
    safeSetJSON("rentals", cleanedRentals);
  }
  if (!localStorage.getItem("bikes")) safeSetJSON("bikes", []);
  if (!localStorage.getItem("rentals")) safeSetJSON("rentals", []);
  if (!localStorage.getItem("routes")) safeSetJSON("routes", []);

  // Navbar setup
  if (currentUser) {
    updateChatNavBadge();
    if (loginLink) loginLink.style.display = "none";
    if (logoutLink) logoutLink.style.display = "inline";
    if (currentUser.role === "admin" && adminLink) adminLink.style.display = "inline";
    if (profileLink) {
      profileLink.style.display = "inline";
      // Add notification badge for owners and renters
      const bikes = JSON.parse(localStorage.getItem("bikes") || "[]");
      const rentals = JSON.parse(localStorage.getItem("rentals") || "[]");
      const seenNotifications = JSON.parse(localStorage.getItem(`seenNotifications_${currentUser.email}`) || "[]");

      // For owners: collect pending/approved request IDs
      const myBikeIds = new Set(bikes.filter(b => b.owner === currentUser.email).map(b => String(b.id)));
      const pendingRentals = rentals.filter(r => r.status === "Pending" && myBikeIds.has(String(r.bikeId)));
      const approvedWaitingSchedule = rentals.filter(r => r.status === "Approved" && !r.pickupSchedule && myBikeIds.has(String(r.bikeId)));
      const approvedWithSchedule = rentals.filter(r => r.status === "Approved" && r.pickupSchedule && myBikeIds.has(String(r.bikeId)));

      // For renters: collect approved without schedule + recently started rentals
      const renterApprovedNoSchedule = rentals.filter(r => r.renter === currentUser.email && r.status === "Approved" && !r.pickupSchedule);
      const recentActive = rentals.filter(r => r.renter === currentUser.email && r.status === "Active" && r.startTime && (Date.now() - r.startTime) < 120000);

      // Collect all notification IDs
      const allNotificationIds = [
        ...pendingRentals.map(r => `pending_${r.id}`),
        ...approvedWaitingSchedule.map(r => `approved_waiting_${r.id}`),
        ...approvedWithSchedule.map(r => `approved_ready_${r.id}`),
        ...renterApprovedNoSchedule.map(r => `renter_approved_${r.id}`),
        ...recentActive.map(r => `renter_active_${r.id}`)
      ];

      // Filter to only show unseen notifications
      const newNotifications = allNotificationIds.filter(id => !seenNotifications.includes(id));
      const totalCount = newNotifications.length;

      if (totalCount > 0) {
        // Build badge title from unseen notifications
        const pendingCount = pendingRentals.filter(r => newNotifications.includes(`pending_${r.id}`)).length;
        const waitingCount = approvedWaitingSchedule.filter(r => newNotifications.includes(`approved_waiting_${r.id}`)).length;
        const readyCount = approvedWithSchedule.filter(r => newNotifications.includes(`approved_ready_${r.id}`)).length;
        const renterScheduleCount = renterApprovedNoSchedule.filter(r => newNotifications.includes(`renter_approved_${r.id}`)).length;
        const renterActiveCount = recentActive.filter(r => newNotifications.includes(`renter_active_${r.id}`)).length;

        const allParts = [];
        if (pendingCount > 0) allParts.push(`${pendingCount} pending`);
        if (waitingCount > 0) allParts.push(`${waitingCount} waiting for schedule`);
        if (readyCount > 0) allParts.push(`${readyCount} ready to start`);
        if (renterScheduleCount > 0) allParts.push(`${renterScheduleCount} need to set schedule`);
        if (renterActiveCount > 0) allParts.push(`${renterActiveCount} rental started`);
        const badgeTitle = allParts.join(', ');

        // Remove existing badge if any
        const existingBadge = profileLink.querySelector('.notification-badge');
        if (existingBadge) existingBadge.remove();

        // Add badge for new notifications
        const badge = document.createElement('span');
        badge.className = 'notification-badge';
        badge.textContent = totalCount > 9 ? '9+' : totalCount;
        badge.title = badgeTitle || 'New notifications';
        profileLink.appendChild(badge);
      } else {
        // Remove badge if no new notifications
        const existingBadge = profileLink.querySelector('.notification-badge');
        if (existingBadge) existingBadge.remove();
      }

      // Remove badge and mark all current notifications as seen when profile is clicked
      profileLink.addEventListener('click', () => {
        const badge = profileLink.querySelector('.notification-badge');
        if (badge) {
          badge.remove();
        }
        // Mark all current notifications as seen, and clean up old ones
        safeSetJSON(`seenNotifications_${currentUser.email}`, allNotificationIds);
      });

      // Clean up seen notifications - remove ones that no longer exist
      const cleanedSeen = seenNotifications.filter(id => allNotificationIds.includes(id));
      if (cleanedSeen.length !== seenNotifications.length) {
        safeSetJSON(`seenNotifications_${currentUser.email}`, cleanedSeen);
      }
    }
    logoutLink?.addEventListener("click", () => {
      showNotification("Logged Out", "You have been logged out successfully.", "info");
      setTimeout(() => {
        localStorage.removeItem("currentUser");
        sessionStorage.removeItem("currentUser");
        window.location.href = "index.html";
      }, 1500);
    });
  }

  // Register
  const registerForm = document.getElementById("registerForm");
  const agreeTermsBtn = document.getElementById("agreeTermsBtn");
  const termsCard = document.getElementById("termsCard");
  if (agreeTermsBtn && registerForm) {
    registerForm.style.display = 'none';
    agreeTermsBtn.addEventListener('click', () => {
      termsCard?.classList.add('accepted');
      if (termsCard) termsCard.style.display = 'none';
      registerForm.style.display = 'block';
    });
  }
  if (registerForm) {
    // Real-time validation function
    const validateField = (fieldId, errorId, checkFn, errorMessage) => {
      const field = document.getElementById(fieldId);
      const errorEl = document.getElementById(errorId);
      if (!field || !errorEl) return false;
      
      const value = field.value.trim();
      if (!value) {
        errorEl.style.display = 'none';
        field.style.borderColor = '';
        return true; // Empty is OK (required will catch it)
      }
      
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      if (checkFn(users, value)) {
        errorEl.textContent = errorMessage;
        errorEl.style.display = 'block';
        field.style.borderColor = '#ef4444';
        return false;
      } else {
        errorEl.style.display = 'none';
        field.style.borderColor = '';
        return true;
      }
    };
    
    // Add real-time validation listeners
    const nameInput = document.getElementById("name");
    const phoneInput = document.getElementById("phone");
    const usernameInput = document.getElementById("username");
    const emailInput = document.getElementById("email");
    
    if (nameInput) {
      nameInput.addEventListener("blur", () => {
        validateField("name", "nameError", 
          (users, value) => users.some(u => (u.name || "").toLowerCase() === value.toLowerCase()),
          "⚠️ This full name is already registered in the system."
        );
      });
      nameInput.addEventListener("input", () => {
        const errorEl = document.getElementById("nameError");
        if (errorEl && errorEl.style.display === 'block') {
          validateField("name", "nameError", 
            (users, value) => users.some(u => (u.name || "").toLowerCase() === value.toLowerCase()),
            "⚠️ This full name is already registered in the system."
          );
        }
      });
    }
    
    if (phoneInput) {
      phoneInput.addEventListener("blur", () => {
        validateField("phone", "phoneError",
          (users, value) => users.some(u => (u.phone || "").trim() === value.trim()),
          "⚠️ This phone number is already registered in the system."
        );
      });
      phoneInput.addEventListener("input", () => {
        const errorEl = document.getElementById("phoneError");
        if (errorEl && errorEl.style.display === 'block') {
          validateField("phone", "phoneError",
            (users, value) => users.some(u => (u.phone || "").trim() === value.trim()),
            "⚠️ This phone number is already registered in the system."
          );
        }
      });
    }
    
    if (usernameInput) {
      usernameInput.addEventListener("blur", () => {
        validateField("username", "usernameError",
          (users, value) => users.some(u => (u.username || "").toLowerCase() === value.toLowerCase()),
          "⚠️ This username is already taken. Please choose another."
        );
      });
      usernameInput.addEventListener("input", () => {
        const errorEl = document.getElementById("usernameError");
        if (errorEl && errorEl.style.display === 'block') {
          validateField("username", "usernameError",
            (users, value) => users.some(u => (u.username || "").toLowerCase() === value.toLowerCase()),
            "⚠️ This username is already taken. Please choose another."
          );
        }
      });
    }
    
    if (emailInput) {
      emailInput.addEventListener("blur", () => {
        const email = emailInput.value.trim().toLowerCase();
        if (email === ADMIN_EMAIL) {
          const errorEl = document.getElementById("emailError");
          if (errorEl) {
            errorEl.textContent = "⚠️ This email is reserved for the administrator.";
            errorEl.style.display = 'block';
            emailInput.style.borderColor = '#ef4444';
          }
          return;
        }
        validateField("email", "emailError",
          (users, value) => users.some(u => (u.email || "").toLowerCase() === value.toLowerCase()),
          "⚠️ This email address is already registered. Please use a different email."
        );
      });
      emailInput.addEventListener("input", () => {
        const errorEl = document.getElementById("emailError");
        if (errorEl && errorEl.style.display === 'block') {
          const email = emailInput.value.trim().toLowerCase();
          if (email === ADMIN_EMAIL) {
            errorEl.textContent = "⚠️ This email is reserved for the administrator.";
            errorEl.style.display = 'block';
            emailInput.style.borderColor = '#ef4444';
            return;
          }
          validateField("email", "emailError",
            (users, value) => users.some(u => (u.email || "").toLowerCase() === value.toLowerCase()),
            "⚠️ This email address is already registered. Please use a different email."
          );
        }
      });
    }
    
    registerForm.addEventListener("submit", e => {
      e.preventDefault();
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      const name = document.getElementById("name").value.trim();
      const phone = document.getElementById("phone").value.trim();
      const address = document.getElementById("address").value.trim();
      const usernameRaw = document.getElementById("username").value.trim();
      const username = usernameRaw.toLowerCase();
      const email = document.getElementById("email").value.trim().toLowerCase();
      const password = document.getElementById("password").value;
      const photoInput = document.getElementById("profilePhoto");
      
      // Validate all fields
      let hasErrors = false;
      
      if (email === ADMIN_EMAIL) {
        const errorEl = document.getElementById("emailError");
        if (errorEl) {
          errorEl.textContent = "⚠️ This email is reserved for the administrator.";
          errorEl.style.display = 'block';
          document.getElementById("email").style.borderColor = '#ef4444';
        }
        hasErrors = true;
      } else if (users.some(u => (u.email || "").toLowerCase() === email)) {
        const errorEl = document.getElementById("emailError");
        if (errorEl) {
          errorEl.textContent = "⚠️ This email address is already registered. Please use a different email.";
          errorEl.style.display = 'block';
          document.getElementById("email").style.borderColor = '#ef4444';
        }
        hasErrors = true;
      }
      
      if (users.some(u => (u.name || "").toLowerCase() === name.toLowerCase())) {
        const errorEl = document.getElementById("nameError");
        if (errorEl) {
          errorEl.textContent = "⚠️ This full name is already registered in the system.";
          errorEl.style.display = 'block';
          document.getElementById("name").style.borderColor = '#ef4444';
        }
        hasErrors = true;
      }
      
      if (users.some(u => (u.phone || "").trim() === phone.trim())) {
        const errorEl = document.getElementById("phoneError");
        if (errorEl) {
          errorEl.textContent = "⚠️ This phone number is already registered in the system.";
          errorEl.style.display = 'block';
          document.getElementById("phone").style.borderColor = '#ef4444';
        }
        hasErrors = true;
      }
      
      if (users.some(u => (u.username || "").toLowerCase() === username)) {
        const errorEl = document.getElementById("usernameError");
        if (errorEl) {
          errorEl.textContent = "⚠️ This username is already taken. Please choose another.";
          errorEl.style.display = 'block';
          document.getElementById("username").style.borderColor = '#ef4444';
        }
        hasErrors = true;
      }
      
      if (hasErrors) {
        showNotification("Validation Error", "Please fix the errors above before submitting.", "error");
        return;
      }
      const finalizeRegistration = (profilePicUrl) => {
      const newUser = {
        id: Date.now(),
        name,
        email,
        password,
          role: "user",
          phone,
          address,
          username: usernameRaw,
          profilePicUrl: profilePicUrl || '',
          status: "pending",
          createdAt: Date.now()
        };
      users.push(newUser);
      if (!safeSetJSON("users", users)) return;
        registerForm.reset();
        if (termsCard) termsCard.style.display = 'block';
        registerForm.style.display = 'none';
        
        // Show confirmation modal
        const confirmModal = document.getElementById("registrationConfirmModal");
        const confirmOkBtn = document.getElementById("registrationConfirmOk");
        if (confirmModal) {
          confirmModal.style.display = 'flex';
          if (confirmOkBtn) {
            confirmOkBtn.onclick = () => {
              confirmModal.style.display = 'none';
              window.location.href = "login.html";
            };
          }
          // Close modal when clicking outside
          confirmModal.onclick = (e) => {
            if (e.target === confirmModal) {
              confirmModal.style.display = 'none';
              window.location.href = "login.html";
            }
          };
        } else {
          // Fallback if modal doesn't exist
          showNotification("Submission Received", "Your account is pending admin approval.", "info");
          setTimeout(() => window.location.href = "login.html", 1500);
        }
      };

      const photoFile = photoInput && photoInput.files && photoInput.files[0];
      if (photoFile) {
        compressImageFile(photoFile).then(finalizeRegistration).catch(() => {
          showNotification("Image Error", "Failed to process profile photo. Submitted without photo.", "warning");
          finalizeRegistration('');
        });
      } else {
        finalizeRegistration('');
      }
    });
  }

  // Login
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", e => {
      e.preventDefault();
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      const email = document.getElementById("email").value.trim().toLowerCase();
      const pass = document.getElementById("password").value;
      let found = users.find(u => (u.email || "").toLowerCase() === email && u.password === pass);
      if (!found && email === ADMIN_EMAIL && pass === DEFAULT_ADMIN.password) {
        // recreate admin account on the fly if missing or credentials drifted
        const adminExists = users.find(u => (u.email || "").toLowerCase() === ADMIN_EMAIL);
        if (!adminExists) {
          users.push({ ...DEFAULT_ADMIN });
          found = { ...DEFAULT_ADMIN };
        } else {
          adminExists.role = "admin";
          adminExists.password = DEFAULT_ADMIN.password;
          adminExists.name = DEFAULT_ADMIN.name;
          found = { ...adminExists };
        }
        // Try to save users, if it fails due to storage, try aggressive cleanup
        if (!safeSetJSON("users", users)) {
          showNotification("Storage Full", "Attempting to free up storage space...", "warning", 4000, true);
          cleanupStorage(true); // Aggressive cleanup
          // Retry after cleanup
          if (!safeSetJSON("users", users)) {
            emergencyCleanup(); // Emergency cleanup
            // Retry after emergency cleanup
            if (!safeSetJSON("users", users)) {
              // Last resort: try to save without admin in users array (admin will be recreated)
              const usersWithoutAdmin = users.filter(u => (u.email || "").toLowerCase() !== ADMIN_EMAIL);
              safeSetJSON("users", usersWithoutAdmin);
              // Admin login will work because we have found = DEFAULT_ADMIN
            }
          }
        }
      }
      if (!found) return alert("Invalid credentials!");
      if (found.status && found.status !== "approved") {
        const statusMsg = found.status === "pending"
          ? "Your account is awaiting admin approval."
          : "Your account was rejected. Please contact support.";
        showNotification("Access Restricted", statusMsg, "warning");
        return;
      }
      // Try to save currentUser, if it fails, try aggressive cleanup
      // Use helper function that tries localStorage then sessionStorage
      if (!setCurrentUser(found)) {
        showNotification("Storage Full", "Attempting to free up storage space...", "warning", 4000, true);
        cleanupStorage(true); // Aggressive cleanup
        // Retry after cleanup
        if (!setCurrentUser(found)) {
          emergencyCleanup(); // Emergency cleanup
          // Retry after emergency cleanup
          if (!setCurrentUser(found)) {
            alert("Storage is critically full. Please clear browser data (Settings > Privacy > Clear browsing data) or contact support.");
            return;
          } else {
            showNotification("Using temporary session", "Logged in with temporary session. Please clear old data.", "warning");
          }
        }
      }
      // For non-admins, if profile incomplete, force setup
      if (found.role !== "admin" && (!found.phone || !found.address)) {
        showNotification("Profile Incomplete", "Please complete your profile to continue.", "warning");
        setTimeout(() => window.location.href = "profile.html?profileSetup=1", 1500);
        return;
      }
      showNotification(`Welcome Back!`, `Hello ${found.name}, you're logged in successfully.`, "success");
      setTimeout(() => window.location.href = found.role === "admin" ? "admin.html" : "index.html", 1500);
    });
  }

  // Post Bike
  const postForm = document.getElementById("postBikeForm");
  if (postForm) {
    if (!currentUser) {
      alert("Please login to post a bike!");
      window.location.href = "login.html";
      return;
    }
    // Image preview handler
    const imageInput = document.getElementById("bikeImages");
    const imagePreview = document.getElementById("imagePreview");

    if (imageInput && imagePreview) {
      imageInput.addEventListener("change", (e) => {
        const files = e.target.files;
        if (files.length > 0) {
          imagePreview.style.display = "block";
          imagePreview.innerHTML = "<strong>Preview:</strong><div style='display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-top:10px;'></div>";
          const previewContainer = imagePreview.querySelector("div");

          Array.from(files).forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              const img = document.createElement("img");
              img.src = event.target.result;
              img.style.width = "100%";
              img.style.height = "100px";
              img.style.objectFit = "cover";
              img.style.borderRadius = "5px";
              img.style.border = "2px solid #ddd";
              previewContainer.appendChild(img);
            };
            reader.readAsDataURL(file);
          });
        } else {
          imagePreview.style.display = "none";
        }
      });
    }

    postForm.addEventListener("submit", e => {
      e.preventDefault();

      // Check again if user is logged in (in case session expired)
      if (!currentUser) {
        alert("Please login to post a bike!");
        window.location.href = "login.html";
        return;
      }

      const bikes = JSON.parse(localStorage.getItem("bikes") || "[]");
      const name = document.getElementById("bikeName").value.trim();
      const category = document.getElementById("bikeCategory").value;
      const description = document.getElementById("bikeDescription").value.trim();
      const rate = parseFloat(document.getElementById("bikeRate").value);
      const imagesInput = document.getElementById("bikeImages");
      const locationText = document.getElementById("bikeLocation").value.trim();
      const isAvailable = document.getElementById("bikeAvailable").checked;

      const baseBike = {
        id: Date.now(),
        owner: currentUser.email,
        name,
        category: category || "Other",
        description,
        rate: isNaN(rate) ? 0 : rate,
        location: locationText,
        available: isAvailable
      };

      const saveAndRedirect = (bikeObj) => {
        bikes.push(bikeObj);
        if (!safeSetJSON("bikes", bikes)) {
          bikes.pop();
          // Try cleanup and retry once
          showNotification("Storage Full", "Attempting to free up storage space...", "warning", 4000, true);
          cleanupStorage();
          if (!safeSetJSON("bikes", bikes)) {
            bikes.pop();
            showNotification("Storage Full", "Cannot save bike. Storage is full. Please delete old bikes/images or clear browser data.", "error", 8000, true);
          return;
          }
        }
        showNotification("Bike Posted", "Your bike has been listed successfully!", "success");
        setTimeout(() => window.location.href = "bikes.html", 1500);
      };

      const files = imagesInput && imagesInput.files ? Array.from(imagesInput.files) : [];
      if (files.length > 0) {
        Promise.all(files.map(file => compressImageFile(file)))
          .then((imageUrls) => {
            if (imageUrls.length > 0) {
              saveAndRedirect({
                ...baseBike,
                imageUrls,
                imageUrl: imageUrls[0]
              });
            } else {
              saveAndRedirect(baseBike);
            }
          })
          .catch((error) => {
            console.error("Failed to process selected images", error);
            showNotification("Image Error", "Failed to process selected images. Please try smaller files.", "error");
          });
      } else {
        saveAndRedirect(baseBike);
      }
    });
  }

  // Show bikes
  const bikeList = document.getElementById("bikeList");
  const bikeSearch = document.getElementById("bikeSearch");
  const bikeCategoryFilter = document.getElementById("bikeCategoryFilter");
  const noResults = document.getElementById("noResults");
  const filterResults = document.getElementById("filterResults");
  const resultCount = document.getElementById("resultCount");
  const clearFilters = document.getElementById("clearFilters");

  if (bikeList) {
    const allBikesData = JSON.parse(localStorage.getItem("bikes")) || [];
    // Base: Show only available bikes to renters
    let allAvailableBikes = allBikesData.filter(b => b.available !== false);

    const renderBikes = (bikesToShow) => {
      if (bikesToShow.length === 0) {
        bikeList.style.display = 'none';
        if (noResults) noResults.style.display = 'block';
      } else {
        bikeList.style.display = '';
        if (noResults) noResults.style.display = 'none';
        bikeList.innerHTML = bikesToShow.map(b => {
          const displayName = b.name || b.model || "Bike";
          const displayRate = (b.rate ?? b.price ?? "");
          const displayDesc = b.description ? `<p>${b.description}</p>` : "";
          const displayLoc = b.location ? `<p><strong>📍 Location:</strong> ${b.location}</p>` : "";
          const category = b.category ? `<span class="bike-category-badge">${b.category}</span>` : '';
          // Use first image from imageUrls array if available, otherwise use imageUrl for backward compatibility
          const primaryImage = (b.imageUrls && b.imageUrls.length > 0) ? b.imageUrls[0] : b.imageUrl;
          const img = primaryImage ? `<img class="card-img bike-image" src="${primaryImage}" alt="${displayName}" data-img="${primaryImage}" data-viewer-src="${primaryImage}">` : `<div class="card-img" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-weight:600;">No Image</div>`;
          const isOwner = !!(currentUser && b.owner === currentUser.email);
          const cta = isOwner ? `<div class="bike-owner-badge">✓ Your bike</div>` : `<button class="btn viewBtn" data-id="${b.id}">View Details</button>`;
          return `
      <div class="card">
        ${img}
        <div>
          ${category}
        </div>
        <h3>${displayName}</h3>
        ${displayDesc}
        ${displayLoc}
        <div class="bike-price">${displayRate}</div>
        ${cta}
      </div>`;
        }).join("");

        // Re-attach event handlers after rendering
        attachBikeEventHandlers();
      }
    };

    const attachBikeEventHandlers = () => {
      // Image viewer - use globally defined handlers
      const viewerImage = document.getElementById('viewerImage');

      const showImageViewer = (imageUrl) => {
        if (viewerImage) viewerImage.src = imageUrl;
        if (imageViewerModal) imageViewerModal.style.display = 'flex';
      };

      // Make bike images clickable
      bikeList.querySelectorAll('.bike-image').forEach(img => {
        img.addEventListener('click', () => {
          const imageUrl = img.getAttribute('data-img');
          if (imageUrl) showImageViewer(imageUrl);
        });
      });

      // View button handlers
      bikeList.querySelectorAll('.viewBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const bikesData = JSON.parse(localStorage.getItem("bikes")) || [];
          const usersData = JSON.parse(localStorage.getItem("users") || "[]");
          const bike = bikesData.find(x => String(x.id) === String(id));
          if (!bike) return;

          // Find owner info
          const owner = usersData.find(u => u.email === bike.owner);
          const ownerName = owner?.name || 'Unknown';
          const ownerEmail = bike.owner || 'Not specified';
          const ownerAvatar = owner?.profilePicUrl
            ? `<img src="${owner.profilePicUrl}" alt="${ownerName}" data-viewer-src="${owner.profilePicUrl}">`
            : `<div class="avatar-fallback">${ownerName ? ownerName.charAt(0).toUpperCase() : 'U'}</div>`;

          const rate = parseFloat(bike.rate ?? bike.price ?? 0) || 0;
          const displayName = bike.name || bike.model || "Bike";
          const displayDesc = bike.description || "No description available.";
          const displayLoc = bike.location || "Location not specified";
          const category = bike.category || "Other";
          const statusColor = bike.available ? '#4caf50' : '#f44336';
          const statusText = bike.available ? 'Available' : 'Currently Rented';

          // Get all images (from imageUrls array if exists, otherwise use imageUrl for backward compatibility)
          const allImages = (bike.imageUrls && bike.imageUrls.length > 0) ? bike.imageUrls : (bike.imageUrl ? [bike.imageUrl] : []);

          // Build image gallery
          let bikeImage = '';
          if (allImages.length > 0) {
            bikeImage = `
              <div class="view-bike-media">
              <div style="position:relative;">
                  <img id="viewBikeMainImage" src="${allImages[0]}" alt="${displayName}" data-viewer-src="${allImages[0]}">
                ${allImages.length > 1 ? `
                    <button id="prevImageBtn" class="view-nav-btn prev">‹</button>
                    <button id="nextImageBtn" class="view-nav-btn next">›</button>
                    <div class="view-image-indicator">
                    <span id="imageCounter">1 / ${allImages.length}</span>
                  </div>
                ` : ''}
              </div>
              ${allImages.length > 1 ? `
                  <div class="view-thumbnails">
                  ${allImages.map((img, idx) => `
                      <img src="${img}" alt="Thumbnail ${idx + 1}" class="bike-thumbnail ${idx === 0 ? 'active' : ''}" data-index="${idx}">
                  `).join('')}
                </div>
              ` : ''}
              </div>
            `;
          } else {
            bikeImage = '<div class="view-bike-media"><div class="no-image-placeholder">📷 No Image Available</div></div>';
          }

          const viewBikeModal = document.getElementById("viewBikeModal");
          const viewBikeContent = document.getElementById("viewBikeContent");

          // Build view modal content - Left: Image, Middle: Details, Right: Owner
          if (viewBikeContent) {
            viewBikeContent.innerHTML = `
              <!-- Left Column: Bike Image -->
              <div style="position:sticky;top:20px;">
                ${bikeImage}
              </div>
              
              <!-- Middle Column: Bike Details -->
              <div>
                <h2 style="margin-top:0;font-size:32px;color:#2c3e50;font-weight:700;margin-bottom:10px;">${displayName}</h2>
                <div style="margin-bottom:15px;">
                  <span style="display:inline-block;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);color:white;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(102,126,234,0.3);">🚴 ${category}</span>
                </div>
                <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:2px solid #e0e0e0;">
                  <p style="margin:0;line-height:1.8;color:#555;font-size:16px;">${displayDesc}</p>
                </div>
                
                <div style="margin:25px 0;padding:20px;background:linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08);border-left:4px solid #2196f3;">
                  <div style="display:flex;align-items:center;margin-bottom:15px;padding-bottom:15px;border-bottom:1px solid #e0e0e0;">
                    <span style="font-size:24px;margin-right:12px;">📍</span>
                    <div>
                      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Location</div>
                      <div style="font-weight:600;color:#2c3e50;font-size:16px;">${displayLoc}</div>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;margin-bottom:15px;padding-bottom:15px;border-bottom:1px solid #e0e0e0;">
                    <span style="font-size:24px;margin-right:12px;">💰</span>
                    <div>
                      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Hourly Rate</div>
                      <div style="font-weight:700;color:#2196f3;font-size:20px;">₱${rate.toLocaleString()}<span style="font-size:14px;font-weight:400;color:#666;">/hour</span></div>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;">
                    <span style="font-size:24px;margin-right:12px;">📊</span>
                    <div>
                      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Status</div>
                      <div style="font-weight:600;color:${statusColor};font-size:16px;">${statusText}</div>
                    </div>
                  </div>
                </div>
                
                <div style="margin-top:25px;">
                  ${currentUser && bike.owner !== currentUser.email && bike.available ? `
                    <button class="btn rentFromViewBtn" data-id="${bike.id}" style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);width:100%;padding:15px;font-size:16px;font-weight:600;border:none;border-radius:10px;color:white;box-shadow:0 6px 20px rgba(102,126,234,0.4);transition:all 0.3s;cursor:pointer;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 25px rgba(102,126,234,0.5)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 6px 20px rgba(102,126,234,0.4)'">
                      🚴 Rent Now
                    </button>
                  ` : ''}
                  ${!currentUser ? `
                    <a href="login.html" class="btn" style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);width:100%;padding:15px;font-size:16px;font-weight:600;border-radius:10px;color:white;box-shadow:0 6px 20px rgba(102,126,234,0.4);transition:all 0.3s;display:block;text-align:center;text-decoration:none;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 25px rgba(102,126,234,0.5)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 6px 20px rgba(102,126,234,0.4)'">
                      🔐 Login to Rent
                    </a>
                  ` : ''}
                  ${bike.owner === currentUser?.email ? `
                    <div style="padding:15px;background:#fff3cd;border-radius:10px;text-align:center;border:2px solid #ffc107;">
                      <span style="font-size:20px;margin-right:8px;">👤</span>
                      <span style="color:#856404;font-weight:600;">This is your bike</span>
                    </div>
                  ` : ''}
                  ${!bike.available ? `
                    <div style="padding:15px;background:#f8d7da;border-radius:10px;text-align:center;border:2px solid #f44336;">
                      <span style="font-size:20px;margin-right:8px;">⏸</span>
                      <span style="color:#721c24;font-weight:600;">This bike is currently rented</span>
                    </div>
                  ` : ''}
                </div>
              </div>
              
              <!-- Right Column: Posted by -->
              <div class="view-bike-card view-bike-owner">
                <div class="view-bike-owner-header">
                  <h3 style="margin:0;">Posted by</h3>
                  <span class="owner-badge">✓ Verified</span>
                </div>
                <div class="view-bike-owner-avatar">
                  ${ownerAvatar}
                  <div>
                    <div style="font-weight:700;font-size:1.05rem;">${ownerName}</div>
                    <div class="owner-meta">${ownerEmail}</div>
                </div>
                </div>
                <p class="owner-trust-copy">
                  All owners undergo manual verification to keep rentals safe and accountable within CYCHRIS.
                </p>
                ${currentUser ? `
                  <a href="profile.html?view=${ownerEmail}" class="btn">
                    Visit Profile
                  </a>
                ` : ''}
              </div>
            `;

            if (viewBikeModal) viewBikeModal.style.display = 'flex';

            // Handle image gallery navigation
            if (allImages.length > 1) {
              let currentImgIndex = 0;
              const mainImage = document.getElementById('viewBikeMainImage');
              const prevBtn = document.getElementById('prevImageBtn');
              const nextBtn = document.getElementById('nextImageBtn');
              const imageCounter = document.getElementById('imageCounter');
              const thumbnails = viewBikeContent.querySelectorAll('.bike-thumbnail');

              const updateImage = (index) => {
                currentImgIndex = index;
                if (mainImage) mainImage.src = allImages[index];
                if (imageCounter) imageCounter.textContent = `${index + 1} / ${allImages.length}`;
                thumbnails.forEach((thumb, idx) => {
                  thumb.classList.toggle('active', idx === index);
                });
              };

              if (prevBtn) {
                prevBtn.onclick = () => {
                  currentImgIndex = (currentImgIndex - 1 + allImages.length) % allImages.length;
                  updateImage(currentImgIndex);
                };
              }

              if (nextBtn) {
                nextBtn.onclick = () => {
                  currentImgIndex = (currentImgIndex + 1) % allImages.length;
                  updateImage(currentImgIndex);
                };
              }

              thumbnails.forEach((thumb, idx) => {
                thumb.onclick = () => updateImage(idx);
              });
            }

            // Handle rent button in view modal
            const rentFromViewBtn = viewBikeContent.querySelector('.rentFromViewBtn');
            if (rentFromViewBtn) {
              rentFromViewBtn.addEventListener('click', () => {
                const viewBikeModal = document.getElementById("viewBikeModal");
                if (viewBikeModal) viewBikeModal.style.display = 'none';
                // Open rent modal
                if (!currentUser) return window.location.href = "login.html";
                if (bike.owner === currentUser.email) {
                  alert("You cannot rent your own bike.");
                  return;
                }
                const modal = document.getElementById("rentModal");
                const nameEl = document.getElementById("rentName");
                const descEl = document.getElementById("rentDesc");
                const locEl = document.getElementById("rentLocation");
                const rateEl = document.getElementById("rentRate");
                const hoursInput = document.getElementById("rentHours");
                const totalEl = document.getElementById("rentTotal");
                const closeEl = document.getElementById("rentClose");
                const cancelEl = document.getElementById("rentCancel");
                const submitEl = document.getElementById("rentSubmit");

                const rate = parseFloat(bike.rate ?? bike.price ?? 0) || 0;
                nameEl.textContent = bike.name || bike.model || "Bike";
                descEl.textContent = bike.description || "";
                locEl.textContent = bike.location || "";
                rateEl.textContent = String(rate);
                hoursInput.value = "1";
                totalEl.innerHTML = `<strong>Total:</strong> ₱${(rate * 1).toFixed(0)}`;

                const compute = () => {
                  const hrs = Math.max(1, parseInt(hoursInput.value || "1", 10));
                  totalEl.innerHTML = `<strong>Total:</strong> ₱${(rate * hrs).toFixed(0)}`;
                };
                hoursInput.oninput = compute;

                const hide = () => { modal.style.display = "none"; };
                closeEl.onclick = hide;
                cancelEl.onclick = hide;

                submitEl.onclick = () => {
                  const rentals = JSON.parse(localStorage.getItem("rentals")) || [];
                  const hrs = Math.max(1, parseInt(hoursInput.value || "1", 10));
                  rentals.push({ id: Date.now(), bikeId: bike.id, renter: currentUser.email, hours: hrs, rate, total: rate * hrs, status: "Pending" });
                  if (!safeSetJSON("rentals", rentals)) return;
                  showNotification("Rental Request Sent", `Request sent to owner for ${hrs} hour(s). Waiting for approval.`, "info");
                  hide();
                };

                modal.style.display = "flex";
              });
            }
          }
        });
      });
    };

    const filterBikes = () => {
      const searchTerm = bikeSearch ? bikeSearch.value.toLowerCase().trim() : '';
      const selectedCategory = bikeCategoryFilter ? bikeCategoryFilter.value : '';

      let filtered = allAvailableBikes;

      // Filter by category
      if (selectedCategory) {
        filtered = filtered.filter(b => b.category === selectedCategory);
      }

      // Filter by search term
      if (searchTerm) {
        filtered = filtered.filter(b => {
          const name = (b.name || b.model || '').toLowerCase();
          const desc = (b.description || '').toLowerCase();
          const loc = (b.location || '').toLowerCase();
          const cat = (b.category || '').toLowerCase();
          return name.includes(searchTerm) || desc.includes(searchTerm) || loc.includes(searchTerm) || cat.includes(searchTerm);
        });
      }

      renderBikes(filtered);

      // Update filter results display
      if (filterResults && (searchTerm || selectedCategory)) {
        filterResults.style.display = 'flex';
        const totalBikes = allAvailableBikes.length;
        const showing = filtered.length;
        if (resultCount) {
          resultCount.textContent = `Showing ${showing} of ${totalBikes} bike${totalBikes !== 1 ? 's' : ''}`;
        }
        if (clearFilters) clearFilters.style.display = 'inline-block';
      } else {
        if (filterResults) filterResults.style.display = 'none';
        if (clearFilters) clearFilters.style.display = 'none';
      }
    };

    // Initial render
    filterBikes();

    // Add event listeners
    if (bikeSearch) {
      bikeSearch.addEventListener('input', filterBikes);
    }

    if (bikeCategoryFilter) {
      bikeCategoryFilter.addEventListener('change', filterBikes);
    }

    if (clearFilters) {
      clearFilters.addEventListener('click', () => {
        if (bikeSearch) bikeSearch.value = '';
        if (bikeCategoryFilter) bikeCategoryFilter.value = '';
        filterBikes();
      });
    }

    // View Bike Modal close handler (set once)
    const viewBikeModal = document.getElementById("viewBikeModal");
    const viewBikeClose = document.getElementById("viewBikeClose");

    const hideViewBike = () => {
      if (viewBikeModal) viewBikeModal.style.display = 'none';
    };

    if (viewBikeClose) viewBikeClose.onclick = hideViewBike;
    if (viewBikeModal) {
      viewBikeModal.addEventListener('click', (e) => {
        if (e.target === viewBikeModal) hideViewBike();
      });
    }

    // Image viewer handlers (set once, used by attachBikeEventHandlers)
    const imageViewerModal = document.getElementById('imageViewerModal');
    const imageViewerClose = document.getElementById('imageViewerClose');

    if (imageViewerClose) {
      imageViewerClose.onclick = () => {
        if (imageViewerModal) imageViewerModal.style.display = 'none';
      };
    }

    // Click outside to close image viewer
    if (imageViewerModal) {
      imageViewerModal.addEventListener('click', (e) => {
        if (e.target === imageViewerModal) imageViewerModal.style.display = 'none';
      });
    }

  }

  // My Rentals
  const rentalList = document.getElementById("rentalList");
  if (rentalList && currentUser) {
    const rentals = JSON.parse(localStorage.getItem("rentals") || "[]").filter(r => r.renter === currentUser.email);
    const bikes = JSON.parse(localStorage.getItem("bikes") || "[]");
    const fmt = (ts) => {
      try { return new Date(ts).toLocaleString(); } catch { return ''; }
    };
    if (!rentals.length) {
      rentalList.innerHTML = `<div class="empty-state admin-empty" style="grid-column:1/-1;text-align:center;">No rentals yet. When you request a bike, it will appear here.</div>`;
    } else {
    rentalList.innerHTML = rentals.map(r => {
      const bike = bikes.find(b => String(b.id) === String(r.bikeId));
      const displayName = bike?.name || bike?.model || "Unknown";
      const rate = r.rate ?? (bike?.rate ?? bike?.price ?? 0);
      const hours = r.hours ?? 1;
      const total = r.total ?? (rate * hours);

      let statusHtml = `<p><strong>Status:</strong> ${r.status}</p>`;

      // For Active rentals, show time details
      if (r.status === 'Active' && r.startTime) {
        const start = r.startTime;
        const end = start + (hours * 60 * 60 * 1000);
        statusHtml = `
          <p><strong>Status:</strong> ${r.status}</p>
          <p><strong>Start Time:</strong> ${fmt(start)}</p>
          <p><strong>Duration:</strong> ${hours} hour(s)</p>
          <p><strong>Estimated End:</strong> ${fmt(end)}</p>
          <p><strong>Total Paid:</strong> ₱${total}</p>
        `;
      } else if (r.status === 'Approved') {
        const scheduleInfo = r.pickupSchedule ? `<p><strong>Pickup Scheduled:</strong> ${fmt(r.pickupSchedule)}</p>` : '';
        statusHtml += scheduleInfo;
      }

      const pickupBtn = r.status === 'Approved' && !r.pickupSchedule
        ? `<button class="btn scheduleBtn" data-id="${r.id}">Set Pickup Schedule</button>`
        : '';

      // Cancel button for Pending and Approved (not Active) rentals
      const cancelBtn = (r.status === 'Pending' || r.status === 'Approved')
        ? `<button class="btn cancelRentalBtn" data-id="${r.id}" style="margin-top:8px;background:#f44336;">Cancel Request</button>`
        : '';

      return `<div class="rental-card">
        <h3>${displayName}</h3>
        ${statusHtml}
        ${pickupBtn}
        ${cancelBtn}
      </div>`;
    }).join("");
    }

    // Pickup schedule handlers
    const pickupModal = document.getElementById('pickupModal');
    const pickupClose = document.getElementById('pickupClose');
    const pickupCancel = document.getElementById('pickupCancel');
    const pickupSave = document.getElementById('pickupSave');
    const pickupDateTime = document.getElementById('pickupDateTime');
    let schedulingRentalId = null;

    const hidePickup = () => { if (pickupModal) pickupModal.style.display = 'none'; };
    const showPickup = () => { if (pickupModal) pickupModal.style.display = 'flex'; };
    if (pickupClose) pickupClose.onclick = hidePickup;
    if (pickupCancel) pickupCancel.onclick = hidePickup;

    rentalList.querySelectorAll('.scheduleBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        schedulingRentalId = btn.getAttribute('data-id');
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        pickupDateTime.value = now.toISOString().slice(0, 16);
        showPickup();
      });
    });

    if (pickupSave) {
      pickupSave.onclick = () => {
        if (!pickupDateTime.value) return alert('Please select pickup date/time.');
        const rentalsData = JSON.parse(localStorage.getItem('rentals') || '[]');
        const idx = rentalsData.findIndex(r => String(r.id) === String(schedulingRentalId));
        if (idx === -1) return hidePickup();
        rentalsData[idx].pickupSchedule = new Date(pickupDateTime.value).getTime();
        if (!safeSetJSON('rentals', rentalsData)) return;
        showNotification("Pickup Scheduled", "Your pickup schedule has been set! Owner has been notified.", "success");
        hidePickup();
        setTimeout(() => location.reload(), 1500);
      };
    }

    // Cancel rental handlers
    rentalList.querySelectorAll('.cancelRentalBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!confirm('Are you sure you want to cancel this rental request?')) return;

        const rentalsData = JSON.parse(localStorage.getItem('rentals') || '[]');
        const bikesData = JSON.parse(localStorage.getItem('bikes') || '[]');
        const idx = rentalsData.findIndex(r => String(r.id) === String(id));
        if (idx === -1) return;

        const rental = rentalsData[idx];
        // If approved, make bike available again
        if (rental.status === 'Approved') {
          const bikeIdx = bikesData.findIndex(b => String(b.id) === String(rental.bikeId));
          if (bikeIdx !== -1) {
            bikesData[bikeIdx].available = true;
            if (!safeSetJSON('bikes', bikesData)) return;
          }
        }

        // Remove rental
        const updated = rentalsData.filter(r => String(r.id) !== String(id));
        if (!safeSetJSON('rentals', updated)) return;
        showNotification("Request Cancelled", "Your rental request has been cancelled.", "info");
        setTimeout(() => location.reload(), 1500);
      });
    });
  }
  if (rentalList && !currentUser) {
    // Guard: require login to view My Rentals
    window.location.href = "login.html";
    return;
  }

  const setTextContent = (id, text) => {
    const el = document.getElementById(id);
    if (el !== null && el !== undefined) {
      el.textContent = text;
    }
  };

  const updateRouteStats = (count) => {
    const label = `${count} route${count === 1 ? '' : 's'} live`;
    setTextContent('statTotalRoutes', count);
    setTextContent('statTotalRoutesText', label);
    setTextContent('statTotalRoutesList', label);
  };

  const getStatusPillClass = (status) => {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'approved' || normalized === 'active') return 'status-pill pill-approved';
    if (normalized === 'pending') return 'status-pill pill-pending';
    if (normalized === 'rejected' || normalized === 'declined' || normalized === 'cancelled') return 'status-pill pill-rejected';
    return 'status-pill';
  };

  const adminRentals = document.getElementById("adminRentals");
  const approvedUsersEl = document.getElementById("approvedUsers");
  const pendingUsersEl = document.getElementById("pendingUsers");
  const rejectedUsersEl = document.getElementById("rejectedUsers");
  const platformAdmin = document.getElementById("platformAdmin");
  const analyticsCards = document.getElementById("analyticsCards");
  const analyticsModal = document.getElementById("analyticsModal");
  const analyticsModalBody = document.getElementById("analyticsModalBody");
  const analyticsModalClose = document.getElementById("analyticsModalClose");
  const rentalsCard = document.getElementById("rentalsCard");
  const usersCard = document.getElementById("usersCard");
  const rentalsModal = document.getElementById("rentalsModal");
  const usersModal = document.getElementById("usersModal");
  const rentalsModalClose = document.getElementById("rentalsModalClose");
  const usersModalClose = document.getElementById("usersModalClose");
  const userCounts = {
    approved: document.getElementById("approvedCount"),
    pending: document.getElementById("pendingCount"),
    rejected: document.getElementById("rejectedCount"),
  };
  const userSearchInput = document.getElementById("userSearch");
  const adminRoutes = document.getElementById("adminRoutes");
  const addRouteForm = document.getElementById("addRouteForm");
  const adminRefreshBtn = document.getElementById("adminRefreshBtn");
  const adminUsersSection = approvedUsersEl || pendingUsersEl || rejectedUsersEl;
  const adminPageActive = rentalsCard
    || usersCard
    || platformAdmin
    || adminUsersSection
    || analyticsCards
    || adminRoutes
    || addRouteForm;
  let adminSnapshot = null;
  const userGroupEls = {
    approved: approvedUsersEl,
    pending: pendingUsersEl,
    rejected: rejectedUsersEl,
  };
  const analyticsReports = {};
  const isAdminUser = (user = {}) => ((user.role || 'user').toLowerCase() === 'admin');
  let cachedAdminUsers = [];
  let cachedRegularUsers = [];

  if (adminPageActive) {
    if (!currentUser || currentUser.role !== "admin") {
      window.location.href = "bikes.html";
      return;
    }

    adminSnapshot = {
      rentals: JSON.parse(localStorage.getItem("rentals") || "[]"),
      bikes: JSON.parse(localStorage.getItem("bikes") || "[]"),
      users: JSON.parse(localStorage.getItem("users") || "[]"),
      routes: JSON.parse(localStorage.getItem("routes") || "[]")
    };

    const allUsers = adminSnapshot.users || [];
    cachedAdminUsers = allUsers.filter(isAdminUser);
    cachedRegularUsers = allUsers.filter(user => !isAdminUser(user));

    const pendingUsers = cachedRegularUsers.filter(u => (u.status || '').toLowerCase() === 'pending').length;
    const approvedUsers = cachedRegularUsers.filter(u => {
      const status = (u.status || '').toLowerCase();
      return status !== 'pending' && status !== 'rejected';
    }).length;
    const rejectedUsers = cachedRegularUsers.filter(u => (u.status || '').toLowerCase() === 'rejected').length;
    setTextContent("statTotalUsers", cachedRegularUsers.length);
    setTextContent("statPendingUsers", `Pending approvals: ${pendingUsers}`);
    setTextContent("approvedCount", approvedUsers);
    setTextContent("pendingCount", pendingUsers);
    setTextContent("rejectedCount", rejectedUsers);
    setTextContent("approvedCountModal", approvedUsers);
    setTextContent("pendingCountModal", pendingUsers);
    setTextContent("rejectedCountModal", rejectedUsers);

    const pendingRentals = adminSnapshot.rentals.filter(r => (r.status || 'pending').toLowerCase() === 'pending').length;
    const approvedRentals = adminSnapshot.rentals.filter(r => (r.status || '').toLowerCase() === 'approved').length;
    setTextContent("statTotalRentals", adminSnapshot.rentals.length);
    setTextContent("statPendingRentalsMini", pendingRentals);
    setTextContent("statPendingRentals", pendingRentals);
    setTextContent("statApprovedRentals", approvedRentals);
    setTextContent("statPendingRentalsModal", pendingRentals);
    setTextContent("statApprovedRentalsModal", approvedRentals);

    setTextContent("statTotalBikes", adminSnapshot.bikes.length);
    updateRouteStats(adminSnapshot.routes.length);

    const greetingEl = document.getElementById("adminGreeting");
    if (greetingEl) greetingEl.textContent = `Welcome back, ${currentUser?.name || 'Admin'}!`;

    if (adminRefreshBtn) {
      adminRefreshBtn.addEventListener("click", () => window.location.reload());
    }
    
    const adminCleanupBtn = document.getElementById("adminCleanupBtn");
    if (adminCleanupBtn) {
      adminCleanupBtn.addEventListener("click", () => {
        if (!confirm("This will remove old completed rentals, old routes, and compress data. Continue?")) return;
        showNotification("Cleaning Storage", "Removing old data to free up space...", "info");
        const cleaned = cleanupStorage(true);
        emergencyCleanup();
        if (cleaned) {
          showNotification("Storage Cleaned", "Old data has been removed. Refreshing page...", "success");
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showNotification("Cleanup Complete", "Storage cleanup completed.", "success");
        }
      });
    }

    const showAnalyticsModal = (reportKey) => {
      if (!analyticsModal || !analyticsReports[reportKey]) return;
      const report = analyticsReports[reportKey];
      const bars = report.bars || [];
      const maxValue = Math.max(...bars.map(b => b.value), 1);
      const barsMarkup = bars.length ? bars.map(bar => `
        <div class="report-bar-row">
          <div class="report-bar-meta">
            <span>${bar.label}</span>
            <span>${bar.meta || bar.value}</span>
          </div>
          <div class="report-bar">
            <div class="report-bar-fill" style="width:${(bar.value / maxValue) * 100}%"></div>
          </div>
        </div>
      `).join('') : '<p class="empty-state">Not enough data available yet for this report.</p>';
      analyticsModalBody.innerHTML = `
        <div class="analytics-modal-header">
          <p class="eyebrow-text">${report.title}</p>
          <h3>${report.summaryValue}</h3>
          <p>${report.summaryMeta}</p>
        </div>
        <div class="report-bars">
          ${barsMarkup}
        </div>
      `;
      analyticsModal.style.display = 'flex';
    };

    const hideAnalyticsModal = () => {
      if (analyticsModal) analyticsModal.style.display = 'none';
    };

    if (analyticsModalClose) {
      analyticsModalClose.onclick = (e) => {
        e.stopPropagation();
        hideAnalyticsModal();
      };
    }
    if (analyticsModal) {
      analyticsModal.addEventListener('click', (e) => {
        if (e.target === analyticsModal) hideAnalyticsModal();
      });
    }

    const renderAnalytics = () => {
      if (!analyticsCards) return;
      const { rentals = [], bikes = [], routes = [] } = adminSnapshot;
      const bikesById = bikes.reduce((acc, bike) => {
        acc[String(bike.id)] = bike;
        return acc;
      }, {});

      const rentalBars = rentals.reduce((acc, rental) => {
        const bikeKey = String(rental.bikeId);
        const bike = bikesById[bikeKey];
        if (!bike) return acc;
        if (!acc[bikeKey]) {
          acc[bikeKey] = {
            label: bike.name || bike.model || `Bike #${bikeKey}`,
            value: 0,
            meta: bike.location || 'Unlisted location'
          };
        }
        acc[bikeKey].value += 1;
        return acc;
      }, {});
      const rentalList = Object.values(rentalBars).sort((a, b) => b.value - a.value);

      const categoryBars = bikes.reduce((acc, bike) => {
        const category = bike.category || 'Uncategorized';
        if (!acc[category]) acc[category] = { label: category, value: 0 };
        acc[category].value += 1;
        return acc;
      }, {});
      const categoryList = Object.values(categoryBars).sort((a, b) => b.value - a.value);

      const routeList = routes.map(route => ({
        label: route.name || 'Route',
        value: route.viewCount || 0,
        meta: `${route.viewCount || 0} view${(route.viewCount || 0) === 1 ? '' : 's'}`
      })).sort((a, b) => b.value - a.value);

      const reports = [
        {
          key: 'rentals',
          icon: '🚲',
          title: 'Most Rented Bike',
          summaryValue: rentalList[0]?.label || 'No rentals yet',
          summaryMeta: rentalList[0] ? `${rentalList[0].value} rental${rentalList[0].value === 1 ? '' : 's'} • ${rentalList[0].meta}` : 'Data populates once bookings start.',
          subtitle: 'Based on rental requests',
          bars: rentalList.slice(0, 5)
        },
        {
          key: 'categories',
          icon: '🗂️',
          title: 'Most Popular Bike Category',
          summaryValue: categoryList[0]?.label || 'No listings yet',
          summaryMeta: categoryList[0] ? `${categoryList[0].value} listing${categoryList[0].value === 1 ? '' : 's'}` : 'Add more bikes to view category trends.',
          subtitle: 'Based on posted bikes',
          bars: categoryList.slice(0, 5).map(cat => ({
            ...cat,
            meta: `${cat.value} listing${cat.value === 1 ? '' : 's'}`
          }))
        },
        {
          key: 'routes',
          icon: '🗺️',
          title: 'Most Viewed Route',
          summaryValue: routeList[0]?.label || (routes.length ? 'No route views yet' : 'No routes published'),
          summaryMeta: routeList[0] ? routeList[0].meta : (routes.length ? 'Encourage riders to explore routes.' : 'Add routes to view analytics.'),
          subtitle: 'Based on public route opens',
          bars: routeList.slice(0, 5)
        }
      ];

      analyticsCards.innerHTML = reports.map(report => {
        analyticsReports[report.key] = report;
        const total = report.bars.reduce((sum, bar) => sum + bar.value, 0) || 0;
        const primaryValue = report.bars[0]?.value || 0;
        const percent = total ? (primaryValue / total) * 100 : (primaryValue ? 100 : 0);
        return `
          <article class="analytics-card" data-report-key="${report.key}">
            <span class="analytics-icon">${report.icon}</span>
            <p class="eyebrow-text" style="margin-bottom:0;">${report.title}</p>
            <h3>${report.summaryValue}</h3>
            <small>${report.summaryMeta}</small>
            <div class="mini-bar">
              <div class="mini-bar-fill" style="width:${percent}%"></div>
            </div>
            <small style="color:var(--text-muted);">${report.subtitle}</small>
          </article>
        `;
      }).join('');

      analyticsCards.querySelectorAll('.analytics-card').forEach(card => {
        const key = card.getAttribute('data-report-key');
        card.addEventListener('click', () => showAnalyticsModal(key));
      });
    };

    renderAnalytics();

  }

  // Card click handlers
  if (rentalsCard && rentalsModal) {
    rentalsCard.addEventListener('click', () => {
      rentalsModal.style.display = 'flex';
      if (adminRentals && adminSnapshot) {
        renderAdminRentals();
      }
    });
  }

  if (rentalsModalClose) {
    rentalsModalClose.onclick = () => {
      if (rentalsModal) rentalsModal.style.display = 'none';
    };
  }

  if (rentalsModal) {
    rentalsModal.addEventListener('click', (e) => {
      if (e.target === rentalsModal) rentalsModal.style.display = 'none';
    });
  }

  if (usersCard && usersModal) {
    usersCard.addEventListener('click', () => {
      usersModal.style.display = 'flex';
      if (adminSnapshot) {
        renderAdminUsers();
        renderPlatformAdmins();
      }
    });
  }

  if (usersModalClose) {
    usersModalClose.onclick = () => {
      if (usersModal) usersModal.style.display = 'none';
    };
  }

  if (usersModal) {
    usersModal.addEventListener('click', (e) => {
      if (e.target === usersModal) usersModal.style.display = 'none';
    });
  }

  // User status card handlers
  const approvedCard = document.getElementById("approvedCard");
  const pendingCard = document.getElementById("pendingCard");
  const rejectedCard = document.getElementById("rejectedCard");
  const approvedUsersModal = document.getElementById("approvedUsersModal");
  const pendingUsersModal = document.getElementById("pendingUsersModal");
  const rejectedUsersModal = document.getElementById("rejectedUsersModal");
  const approvedUsersModalClose = document.getElementById("approvedUsersModalClose");
  const pendingUsersModalClose = document.getElementById("pendingUsersModalClose");
  const rejectedUsersModalClose = document.getElementById("rejectedUsersModalClose");
  const approvedUserSearch = document.getElementById("approvedUserSearch");
  const pendingUserSearch = document.getElementById("pendingUserSearch");
  const rejectedUserSearch = document.getElementById("rejectedUserSearch");

  if (approvedCard && approvedUsersModal) {
    approvedCard.addEventListener('click', () => {
      approvedUsersModal.style.display = 'flex';
      if (adminSnapshot && approvedUsersEl) {
        const searchTerm = approvedUserSearch ? approvedUserSearch.value : '';
        renderUsersByStatus('approved', approvedUsersEl, searchTerm);
      }
    });
  }

  if (approvedUsersModalClose) {
    approvedUsersModalClose.onclick = () => {
      if (approvedUsersModal) approvedUsersModal.style.display = 'none';
    };
  }

  if (approvedUsersModal) {
    approvedUsersModal.addEventListener('click', (e) => {
      if (e.target === approvedUsersModal) approvedUsersModal.style.display = 'none';
    });
  }

  if (pendingCard && pendingUsersModal) {
    pendingCard.addEventListener('click', () => {
      pendingUsersModal.style.display = 'flex';
      if (adminSnapshot && pendingUsersEl) {
        const searchTerm = pendingUserSearch ? pendingUserSearch.value : '';
        renderUsersByStatus('pending', pendingUsersEl, searchTerm);
      }
    });
  }

  if (pendingUsersModalClose) {
    pendingUsersModalClose.onclick = () => {
      if (pendingUsersModal) pendingUsersModal.style.display = 'none';
    };
  }

  if (pendingUsersModal) {
    pendingUsersModal.addEventListener('click', (e) => {
      if (e.target === pendingUsersModal) pendingUsersModal.style.display = 'none';
    });
  }

  if (rejectedCard && rejectedUsersModal) {
    rejectedCard.addEventListener('click', () => {
      rejectedUsersModal.style.display = 'flex';
      if (adminSnapshot && rejectedUsersEl) {
        const searchTerm = rejectedUserSearch ? rejectedUserSearch.value : '';
        renderUsersByStatus('rejected', rejectedUsersEl, searchTerm);
      }
    });
  }

  if (rejectedUsersModalClose) {
    rejectedUsersModalClose.onclick = () => {
      if (rejectedUsersModal) rejectedUsersModal.style.display = 'none';
    };
  }

  if (rejectedUsersModal) {
    rejectedUsersModal.addEventListener('click', (e) => {
      if (e.target === rejectedUsersModal) rejectedUsersModal.style.display = 'none';
    });
  }

  // Render rentals in modal
  const renderAdminRentals = () => {
    if (!adminRentals || !adminSnapshot) return;
    const rentals = adminSnapshot.rentals;
    if (!rentals.length) {
      adminRentals.innerHTML = `<div class="empty-state admin-empty">No rentals yet.</div>`;
    } else {
      const bikesMap = adminSnapshot.bikes.reduce((acc, bike) => {
        acc[String(bike.id)] = bike;
        return acc;
      }, {});
      const usersMap = adminSnapshot.users.reduce((acc, user) => {
        if (user.email) acc[user.email.toLowerCase()] = user;
        return acc;
      }, {});
      adminRentals.innerHTML = rentals
        .sort((a, b) => Number(b.id) - Number(a.id))
        .map(r => {
          const bike = bikesMap[String(r.bikeId)] || {};
          const renter = usersMap[(r.renter || '').toLowerCase()];
          const bikeName = bike.name || bike.model || "Bike";
          const statusText = r.status || 'Pending';
          const statusClass = getStatusPillClass(statusText);
          const hours = r.hours || 0;
          const rate = r.rate || 0;
          const total = r.total || (rate * hours);
          return `
            <article class="admin-card rental-card">
              <div class="rental-card-head">
        <div>
                  <p class="eyebrow-text">${bike.category || 'Bike'}</p>
                  <h3>${bikeName}</h3>
                  <small>${bike.location || 'Location pending'}</small>
        </div>
                <span class="${statusClass}">${statusText}</span>
      </div>
              <div class="rental-card-body">
                <div>
                  <span>Renter</span>
                  <strong>${renter?.name || r.renter}</strong>
                  <small>${r.renter}</small>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>${hours} hrs</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>₱${Number(total || 0).toLocaleString()}</strong>
                  <small>₱${Number(rate || 0).toLocaleString()} / hr</small>
                </div>
              </div>
              <div class="rental-card-footer">
                <span>Requested on ${new Date(r.id).toLocaleDateString()}</span>
                <span>${bike.owner ? `Owner: ${bike.owner}` : ''}</span>
              </div>
            </article>
          `;
        }).join("");
    }
  }

  const renderPlatformAdmins = (admins) => {
    if (!platformAdmin) return;
    platformAdmin.innerHTML = admins.length ? admins.map(admin => {
        const initials = (admin.name || admin.email || 'A').charAt(0).toUpperCase();
        const registered = admin.createdAt ? new Date(admin.createdAt).toLocaleDateString() : '—';
        const avatarHTML = admin.profilePicUrl
          ? `<img src="${admin.profilePicUrl}" alt="${admin.name || admin.email}" data-viewer-src="${admin.profilePicUrl}">`
          : `<span>${initials}</span>`;
        return `
          <article class="platform-admin-card">
            <div class="platform-admin-avatar">${avatarHTML}</div>
            <div class="platform-admin-meta">
              <p class="eyebrow-text" style="color:rgba(255,255,255,0.75);margin-bottom:0.35rem;">Platform Admin</p>
              <h3>${admin.name || 'Admin'}</h3>
              <p>${admin.email}</p>
              <div class="platform-admin-tags">
                <span>Role: ${admin.role || 'admin'}</span>
                <span>Registered: ${registered}</span>
              </div>
            </div>
            <div class="platform-admin-actions">
              <button class="btn viewUserBtn" data-email="${admin.email}">View</button>
              <button class="btn editUserBtn" data-email="${admin.email}">Edit</button>
              <button class="btn postsUserBtn" data-email="${admin.email}">Posts</button>
            </div>
          </article>
        `;
      }).join('') : '';
  };

  // Render users by status for nested modals
  const renderUsersByStatus = (status, container, searchTerm = '') => {
    if (!container || !adminSnapshot) return;
    const baseUsers = cachedRegularUsers.length
      ? cachedRegularUsers
      : (adminSnapshot.users || []).filter(user => !isAdminUser(user));
    const filter = searchTerm.trim().toLowerCase();
    const users = baseUsers.filter(u => {
      const userStatus = ['pending', 'rejected'].includes((u.status || '').toLowerCase())
        ? (u.status || '').toLowerCase()
        : 'approved';
      if (userStatus !== status) return false;
      if (filter) {
        const searchBlob = `${u.name || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase();
        return searchBlob.includes(filter);
      }
      return true;
    });

    const countEl = document.getElementById(`${status}CountModal`);
    if (countEl) countEl.textContent = users.length;

    if (!users.length) {
      container.innerHTML = `<div class="empty-state admin-empty">No ${status} users.</div>`;
    } else {
      container.innerHTML = users.map(u => {
        const initials = (u.name || u.email || 'U').charAt(0).toUpperCase();
        const statusRaw = u.status || 'approved';
        const statusText = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
        const registeredOn = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—';
        const userAvatarHTML = u.profilePicUrl
          ? `<img src="${u.profilePicUrl}" alt="${u.name || u.email}" data-viewer-src="${u.profilePicUrl}">`
          : `<span>${initials}</span>`;
        return `
          <article class="admin-card user-card">
            <div class="user-card-main">
              <div class="user-avatar">${userAvatarHTML}</div>
              <div>
                <h3>${u.name || 'Unnamed User'}</h3>
                <p>${u.email}</p>
              </div>
              <span class="${getStatusPillClass(statusRaw)}">${statusText}</span>
            </div>
            <div class="user-card-meta">
              <div>
                <span>Role</span>
                <strong>${u.role || 'user'}</strong>
              </div>
              <div>
                <span>Registered</span>
                <strong>${registeredOn}</strong>
              </div>
            </div>
            <div class="user-card-actions">
          <button class="btn viewUserBtn" data-email="${u.email}">View</button>
              <button class="btn editUserBtn" data-email="${u.email}">Edit</button>
              <button class="btn postsUserBtn" data-email="${u.email}">Posts</button>
              ${u.status !== 'pending' ? `<button class="btn deleteUserBtn" data-email="${u.email}">Delete</button>` : ''}
              ${u.status === 'pending'
                ? `<button class="btn approveUserBtn" data-email="${u.email}">Approve</button>
                   <button class="btn btn-outline rejectUserBtn" data-email="${u.email}">Reject</button>`
                : u.status === 'rejected'
                  ? `<button class="btn approveUserBtn" data-email="${u.email}">Approve</button>`
                  : ''}
        </div>
          </article>
        `;
      }).join('');
      wireUserActions();
    }
  };

  // Search handlers for status modals
  if (approvedUserSearch) {
    approvedUserSearch.addEventListener('input', (e) => {
      if (adminSnapshot) {
        renderUsersByStatus('approved', approvedUsersEl, e.target.value || '');
      }
    });
  }

  if (pendingUserSearch) {
    pendingUserSearch.addEventListener('input', (e) => {
      if (adminSnapshot) {
        renderUsersByStatus('pending', pendingUsersEl, e.target.value || '');
      }
    });
  }

  if (rejectedUserSearch) {
    rejectedUserSearch.addEventListener('input', (e) => {
      if (adminSnapshot) {
        renderUsersByStatus('rejected', rejectedUsersEl, e.target.value || '');
      }
    });
  }

  const renderUserGroups = (users, term = '') => {
    const filter = term.trim().toLowerCase();
    const grouped = {
      approved: [],
      pending: [],
      rejected: [],
    };

    users.forEach(user => {
      const searchBlob = `${user.name || ''} ${user.email || ''} ${user.role || ''}`.toLowerCase();
      if (filter && !searchBlob.includes(filter)) return;
      const statusKey = ['pending', 'rejected'].includes((user.status || '').toLowerCase())
        ? (user.status || '').toLowerCase()
        : 'approved';
      grouped[statusKey].push(user);
    });

    Object.entries(grouped).forEach(([status, list]) => {
      const container = userGroupEls[status];
      const countEl = userCounts[status];
      if (countEl) countEl.textContent = list.length;
      if (!container) return;
      if (!list.length) {
        container.innerHTML = `<div class="empty-state admin-empty">No ${status} users.</div>`;
      } else {
        container.innerHTML = list.map(u => {
        const initials = (u.name || u.email || 'U').charAt(0).toUpperCase();
          const statusRaw = u.status || 'approved';
          const statusText = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
        const registeredOn = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—';
        const userAvatarHTML = u.profilePicUrl
          ? `<img src="${u.profilePicUrl}" alt="${u.name || u.email}" data-viewer-src="${u.profilePicUrl}">`
          : `<span>${initials}</span>`;
        return `
          <article class="admin-card user-card">
            <div class="user-card-main">
              <div class="user-avatar">${userAvatarHTML}</div>
              <div>
                <h3>${u.name || 'Unnamed User'}</h3>
                <p>${u.email}</p>
      </div>
              <span class="${getStatusPillClass(statusRaw)}">${statusText}</span>
            </div>
            <div class="user-card-meta">
              <div>
                <span>Role</span>
                <strong>${u.role || 'user'}</strong>
              </div>
              <div>
                <span>Registered</span>
                <strong>${registeredOn}</strong>
              </div>
            </div>
            <div class="user-card-actions">
              <button class="btn viewUserBtn" data-email="${u.email}">View</button>
              <button class="btn editUserBtn" data-email="${u.email}">Edit</button>
              <button class="btn postsUserBtn" data-email="${u.email}">Posts</button>
              <button class="btn deleteUserBtn" data-email="${u.email}">Delete</button>
              ${u.status === 'pending'
                ? `<button class="btn approveUserBtn" data-email="${u.email}">Approve</button>
                   <button class="btn btn-outline rejectUserBtn" data-email="${u.email}">Reject</button>`
                : u.status === 'rejected'
                  ? `<button class="btn approveUserBtn" data-email="${u.email}">Approve</button>`
                  : ''}
            </div>
          </article>
        `;
        }).join("");
      }
    });
  };

  const wireUserActions = () => {
    const actionContainers = [
      platformAdmin,
      userGroupEls.approved,
      userGroupEls.pending,
      userGroupEls.rejected
    ].filter(Boolean);
    const scopedQueryAll = (selector) => {
      const nodes = [];
      actionContainers.forEach(container => {
        container.querySelectorAll(selector).forEach(node => nodes.push(node));
      });
      return nodes;
    };

    const viewModal = document.getElementById('viewUserModal');
    const viewClose = document.getElementById('viewUserClose');
    const viewOk = document.getElementById('viewUserOk');
    const viewBody = document.getElementById('viewUserBody');
    const hideView = () => { if (viewModal) viewModal.style.display = 'none'; };
    const showView = () => { if (viewModal) viewModal.style.display = 'flex'; };

    const editModal = document.getElementById('editUserModal');
    const editClose = document.getElementById('editUserClose');
    const editCancel = document.getElementById('editUserCancel');
    const editSave = document.getElementById('editUserSave');
    const editName = document.getElementById('editUserName');
    const editEmail = document.getElementById('editUserEmail');
    const editPassword = document.getElementById('editUserPassword');
    const editRole = document.getElementById('editUserRole');
    const hideEditUser = () => { if (editModal) editModal.style.display = 'none'; };
    const showEditUser = () => { if (editModal) editModal.style.display = 'flex'; };

    if (viewClose) viewClose.onclick = hideView;
    if (viewOk) viewOk.onclick = hideView;
    if (editClose) editClose.onclick = hideEditUser;
    if (editCancel) editCancel.onclick = hideEditUser;

    // Posts modal wiring
    const postsModal = document.getElementById('userPostsModal');
    const postsClose = document.getElementById('userPostsClose');
    const postsOk = document.getElementById('userPostsOk');
    const postsBody = document.getElementById('userPostsBody');
    const hidePosts = () => { if (postsModal) postsModal.style.display = 'none'; };
    const showPosts = () => { if (postsModal) postsModal.style.display = 'flex'; };
    if (postsClose) postsClose.onclick = hidePosts;
    if (postsOk) postsOk.onclick = hidePosts;

    const renderUserPosts = (ownerEmail) => {
      const bikes = JSON.parse(localStorage.getItem('bikes')) || [];
      const mine = bikes.filter(b => b.owner === ownerEmail);
      postsBody.innerHTML = mine.length ? mine.map(b => {
        const name = b.name || b.model || 'Bike';
        const rate = b.rate ?? b.price ?? '';
        const img = b.imageUrl ? `<img class=\"card-img\" src=\"${b.imageUrl}\" alt=\"${name}\" data-viewer-src=\"${b.imageUrl}\">` : '';
        const status = b.available ? 'Available' : 'Rented';
        return `
        <div class=\"card\">
          ${img}
          <h3>${name}</h3>
          <p>₱${rate}/hour</p>
          <p>Status: ${status}</p>
          <div>
            <button class=\"btn deletePostBtn\" data-id=\"${b.id}\">Delete</button>
          </div>
        </div>`;
      }).join('') : '<p>No posts.</p>';

      postsBody.querySelectorAll('.deletePostBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          if (!confirm('Delete this post?')) return;
          const bikesData = JSON.parse(localStorage.getItem('bikes')) || [];
          const remaining = bikesData.filter(x => String(x.id) !== String(id));
          if (!safeSetJSON('bikes', remaining)) return;
          const rentals = JSON.parse(localStorage.getItem('rentals')) || [];
          const rentalsRemaining = rentals.filter(r => String(r.bikeId) !== String(id));
          if (!safeSetJSON('rentals', rentalsRemaining)) return;
          renderUserPosts(ownerEmail);
        });
      });
    };

    scopedQueryAll('.postsUserBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        renderUserPosts(email);
        showPosts();
      });
    });

    scopedQueryAll('.viewUserBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        const allUsers = JSON.parse(localStorage.getItem('users')) || [];
        const user = allUsers.find(u => u.email === email);
        const bikes = JSON.parse(localStorage.getItem('bikes')) || [];
        const rentals = JSON.parse(localStorage.getItem('rentals')) || [];
        const posted = bikes.filter(b => b.owner === email).length;
        const asRenter = rentals.filter(r => r.renter === email).length;
        const avatar = user?.profilePicUrl ? `<img class=\"profile-img\" src=\"${user.profilePicUrl}\" alt=\"Avatar\">` : '';
        viewBody.innerHTML = `
          ${avatar}
          <p><strong>Name:</strong> ${user?.name || ''}</p>
          <p><strong>Email:</strong> ${user?.email || ''}</p>
          <p><strong>Phone:</strong> ${user?.phone || ''}</p>
          <p><strong>Address:</strong> ${user?.address || ''}</p>
          <p><strong>Role:</strong> ${user?.role || ''}</p>
          <p><strong>Posted Bikes:</strong> ${posted}</p>
          <p><strong>Rental Requests:</strong> ${asRenter}</p>
        `;
        showView();
      });
    });

    scopedQueryAll('.editUserBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        const allUsers = JSON.parse(localStorage.getItem('users')) || [];
        const user = allUsers.find(u => u.email === email);
        if (!user) return;
        editName.value = user.name || '';
        editEmail.value = user.email || '';
        editPassword.value = '';
        editRole.value = user.role || 'user';
        showEditUser();
        if (editSave) {
          editSave.onclick = () => {
            const usersSave = JSON.parse(localStorage.getItem('users')) || [];
            const idx = usersSave.findIndex(u => u.email === email);
            if (idx === -1) return hideEditUser();
            const newEmail = editEmail.value.trim().toLowerCase();
            if (usersSave.some((u, i) => i !== idx && (u.email || '').toLowerCase() === newEmail)) {
              alert('Email already in use.');
              return;
            }
            usersSave[idx] = {
              ...usersSave[idx],
              name: editName.value.trim(),
              email: newEmail,
              role: editRole.value,
              password: editPassword.value ? editPassword.value : usersSave[idx].password
            };
            if (!safeSetJSON('users', usersSave)) return;
            if (email !== newEmail) {
              const bikesData = JSON.parse(localStorage.getItem('bikes')) || [];
              bikesData.forEach(b => { if (b.owner === email) b.owner = newEmail; });
              if (!safeSetJSON('bikes', bikesData)) return;
              const rentalsData = JSON.parse(localStorage.getItem('rentals')) || [];
              rentalsData.forEach(r => { if (r.renter === email) r.renter = newEmail; });
              if (!safeSetJSON('rentals', rentalsData)) return;
              if (currentUser && currentUser.email === email) {
                if (!safeSetJSON('currentUser', usersSave[idx])) return;
              }
            }
            hideEditUser();
            location.reload();
          };
        }
      });
    });

    scopedQueryAll('.deleteUserBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        if (!confirm('Delete this user and all associated data?')) return;
        const usersData = JSON.parse(localStorage.getItem('users')) || [];
        const remainingUsers = usersData.filter(u => u.email !== email);
        if (!safeSetJSON('users', remainingUsers)) return;
        const bikesData = JSON.parse(localStorage.getItem('bikes')) || [];
        const bikesRemaining = bikesData.filter(b => b.owner !== email);
        if (!safeSetJSON('bikes', bikesRemaining)) return;
        const rentalsData = JSON.parse(localStorage.getItem('rentals')) || [];
        const rentalsRemaining = rentalsData.filter(r => r.renter !== email);
        if (!safeSetJSON('rentals', rentalsRemaining)) return;
        if (currentUser && currentUser.email === email) {
          localStorage.removeItem('currentUser');
          window.location.href = 'login.html';
          return;
        }
        location.reload();
      });
    });

    const changeUserStatus = (email, status) => {
      const usersData = JSON.parse(localStorage.getItem('users') || '[]');
      const idx = usersData.findIndex(u => u.email === email);
      if (idx === -1) return;
      usersData[idx].status = status;
      if (!safeSetJSON('users', usersData)) return;
      showNotification("User Updated", `Account marked as ${status}.`, status === 'approved' ? 'success' : 'info');
      setTimeout(() => location.reload(), 1000);
    };

    scopedQueryAll('.approveUserBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        changeUserStatus(email, 'approved');
      });
    });

    scopedQueryAll('.rejectUserBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        changeUserStatus(email, 'rejected');
      });
    });
  };

  if ((Object.values(userGroupEls).some(Boolean) || platformAdmin) && adminSnapshot) {
    const adminsOnly = cachedAdminUsers.length ? cachedAdminUsers : (adminSnapshot.users || []).filter(isAdminUser);
    const regularUsers = cachedRegularUsers.length ? cachedRegularUsers : (adminSnapshot.users || []).filter(user => !isAdminUser(user));

    renderPlatformAdmins(adminsOnly);
    renderUserGroups(regularUsers);
    wireUserActions();

    if (userSearchInput) {
      userSearchInput.addEventListener('input', (e) => {
        renderUserGroups(regularUsers, e.target.value || '');
        wireUserActions();
      });
    }
  }

  const renderAdminRoutes = () => {
    if (!adminRoutes) return;
    const routes = JSON.parse(localStorage.getItem('routes') || '[]');
    if (!routes.length) {
      adminRoutes.innerHTML = `<div class="empty-state admin-empty">No routes have been published yet.</div>`;
      updateRouteStats(0);
      return;
    }
    updateRouteStats(routes.length);
    adminRoutes.innerHTML = routes.map(route => `
      <article class="admin-card admin-route-card">
        ${route.photoUrl ? `<img src="${route.photoUrl}" alt="${route.name}" data-viewer-src="${route.photoUrl}">` : ''}
        <h3>${route.name}</h3>
        <p>${route.description}</p>
        <div class="route-meta">
          <span>🗂 ${route.type}</span>
          <span>📍 ${route.startLocation} → ${route.endLocation}</span>
          <span>📏 ${route.distance}</span>
          <span>⏱ ${route.timeEstimate}</span>
        </div>
        <footer>
          <small>Added ${new Date(route.createdAt || route.id).toLocaleString()}</small>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn btn-outline editRouteBtn" data-id="${route.id}">Edit</button>
            <button class="btn btn-danger deleteRouteBtn" data-id="${route.id}">Delete</button>
          </div>
        </footer>
      </article>
    `).join('');

    adminRoutes.querySelectorAll('.editRouteBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const routesData = JSON.parse(localStorage.getItem('routes') || '[]');
        const selected = routesData.find(r => String(r.id) === String(id));
        if (!selected) return;
        openRouteEditor(selected);
      });
    });

    adminRoutes.querySelectorAll('.deleteRouteBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!confirm('Delete this route?')) return;
        const routesData = JSON.parse(localStorage.getItem('routes') || '[]').filter(r => String(r.id) !== String(id));
        if (!safeSetJSON('routes', routesData)) return;
        showNotification("Route Removed", "The route has been deleted.", "info");
        renderAdminRoutes();
      });
    });
  };

  if (addRouteForm) {
    if (!currentUser || currentUser.role !== 'admin') {
      window.location.href = 'bikes.html';
      return;
    }
    addRouteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('routeName').value.trim();
      const type = document.getElementById('routeType').value;
      const startLocation = document.getElementById('routeStart').value.trim();
      const endLocation = document.getElementById('routeEnd').value.trim();
      const distance = document.getElementById('routeDistance').value.trim();
      const timeEstimate = document.getElementById('routeTime').value.trim();
      const description = document.getElementById('routeDescription').value.trim();
      const mapSnippet = document.getElementById('routeMapLink').value.trim();
      const photoInput = document.getElementById('routePhoto');
      const routes = JSON.parse(localStorage.getItem('routes') || '[]');

      const saveRoute = (photoUrl) => {
        const newRoute = {
          id: Date.now(),
          name,
          type,
          startLocation,
          endLocation,
          distance,
          timeEstimate,
          description,
          mapEmbed: mapSnippet,
          photoUrl: photoUrl || '',
          createdAt: Date.now(),
          createdBy: currentUser.email
        };
        routes.push(newRoute);
        if (!safeSetJSON('routes', routes)) return;
        showNotification("Route Published", "New route is now visible on the Routes page.", "success");
        addRouteForm.reset();
        renderAdminRoutes();
      };

      const photoFile = photoInput && photoInput.files && photoInput.files[0];
      if (photoFile) {
        compressImageFile(photoFile, 800, 0.7).then(saveRoute).catch(() => {
          showNotification("Image Error", "Failed to process route photo. Route saved without photo.", "warning");
          saveRoute('');
        });
      } else {
        saveRoute('');
      }
    });

    renderAdminRoutes();
  }

  const openRouteEditor = (route) => {
    const editor = document.getElementById('routeEditor');
    if (!editor || !route) return;
    editor.style.display = 'flex';
    document.getElementById('editRouteId').value = route.id;
    document.getElementById('editRouteName').value = route.name || '';
    document.getElementById('editRouteType').value = route.type || '';
    document.getElementById('editRouteStart').value = route.startLocation || '';
    document.getElementById('editRouteEnd').value = route.endLocation || '';
    document.getElementById('editRouteDistance').value = route.distance || '';
    document.getElementById('editRouteTime').value = route.timeEstimate || '';
    document.getElementById('editRouteDescription').value = route.description || '';
    document.getElementById('editRouteMapLink').value = route.mapEmbed || '';
  };

  const routeEditor = document.getElementById('routeEditor');
  const editRouteClose = document.getElementById('editRouteClose');
  const editRouteCancel = document.getElementById('editRouteCancel');
  const editRouteForm = document.getElementById('editRouteForm');
  if (routeEditor && editRouteForm) {
    const hideEditor = () => routeEditor.style.display = 'none';
    editRouteClose?.addEventListener('click', hideEditor);
    editRouteCancel?.addEventListener('click', hideEditor);
    routeEditor.addEventListener('click', (e) => {
      if (e.target === routeEditor) hideEditor();
    });

    editRouteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('editRouteId').value;
      const name = document.getElementById('editRouteName').value.trim();
      const type = document.getElementById('editRouteType').value;
      const startLocation = document.getElementById('editRouteStart').value.trim();
      const endLocation = document.getElementById('editRouteEnd').value.trim();
      const distance = document.getElementById('editRouteDistance').value.trim();
      const timeEstimate = document.getElementById('editRouteTime').value.trim();
      const description = document.getElementById('editRouteDescription').value.trim();
      const mapSnippet = document.getElementById('editRouteMapLink').value.trim();
      const photoInput = document.getElementById('editRoutePhoto');
      const routes = JSON.parse(localStorage.getItem('routes') || '[]');
      const idx = routes.findIndex(r => String(r.id) === String(id));
      if (idx === -1) {
        hideEditor();
        return;
      }
      const saveUpdatedRoute = (photoUrl) => {
        routes[idx] = {
          ...routes[idx],
          name,
          type,
          startLocation,
          endLocation,
          distance,
          timeEstimate,
          description,
          mapEmbed: mapSnippet || routes[idx].mapEmbed,
          photoUrl: photoUrl ?? routes[idx].photoUrl
        };
        if (!safeSetJSON('routes', routes)) return;
        showNotification("Route Updated", "Changes have been saved.", "success");
        hideEditor();
        renderAdminRoutes();
      };
      const newPhoto = photoInput && photoInput.files && photoInput.files[0];
      if (newPhoto) {
        compressImageFile(newPhoto, 800, 0.7).then(saveUpdatedRoute).catch(() => {
          showNotification("Image Error", "Failed to process new photo. Keeping previous one.", "warning");
          saveUpdatedRoute(undefined);
        });
      } else {
        saveUpdatedRoute(undefined);
      }
    });
  }

  // Profile Page
  const profileInfo = document.getElementById("profileInfo");
  const myPosts = document.getElementById("myPosts");
  const ownerRequests = document.getElementById("ownerRequests");
  const ownerApproved = document.getElementById("ownerApproved");
  const ownerActive = document.getElementById("ownerActive");
  const routeList = document.getElementById("routeList");
  const noRoutes = document.getElementById("noRoutes");
  const routeModal = document.getElementById("routeModal");
  const routeModalClose = document.getElementById("routeModalClose");
  const routeModalBody = document.getElementById("routeModalBody");
  const routeSearch = document.getElementById("routeSearch");
  const routeTypeFilter = document.getElementById("routeTypeFilter");
  if (routeList) {
    const incrementRouteView = (routeId) => {
      if (!routeId) return null;
      const routesData = JSON.parse(localStorage.getItem('routes') || '[]');
      const idx = routesData.findIndex(r => String(r.id) === String(routeId));
      if (idx === -1) return null;
      routesData[idx] = {
        ...routesData[idx],
        viewCount: (routesData[idx].viewCount || 0) + 1
      };
      if (!safeSetJSON('routes', routesData)) return routesData[idx];
      return routesData[idx];
    };

    const openRouteModal = (route) => {
      if (!route || !routeModal || !routeModalBody) return;
      const mapSection = route.mapEmbed ? `
        <div class="route-map-panel">
          <h3 style="margin:0;">📍 Route Map</h3>
          <div class="route-map-embed">
            ${route.mapEmbed}
          </div>
        </div>` : '';

      const infoBlock = `
        <div class="route-detail-card">
          <span class="how-pill">${route.type}</span>
          <h2 style="margin:0.5rem 0 0.75rem;">${route.name}</h2>
          <p>${route.description}</p>
          <div class="route-detail-info">
            <div>
              <span>Start</span>
              ${route.startLocation}
            </div>
            <div>
              <span>End</span>
              ${route.endLocation}
            </div>
            <div>
              <span>Distance</span>
              ${route.distance}
            </div>
            <div>
              <span>Time</span>
              ${route.timeEstimate}
            </div>
          </div>
        </div>
      `;
      const mediaBlock = route.photoUrl
        ? `<div class="route-modal-media"><img src="${route.photoUrl}" alt="${route.name}" data-viewer-src="${route.photoUrl}"></div>`
        : `<div class="route-modal-media placeholder">🚴‍♂️</div>`;
      routeModalBody.innerHTML = `<div class="route-modal-body">${mediaBlock}${infoBlock}${mapSection}</div>`;
      routeModal.style.display = 'flex';
    };

    const renderRoutesPublic = () => {
      const routes = JSON.parse(localStorage.getItem('routes') || '[]');
      const searchTerm = (routeSearch?.value || '').toLowerCase().trim();
      const selectedType = routeTypeFilter?.value || '';
      const filtered = routes.filter(route => {
        const matchesType = selectedType ? route.type === selectedType : true;
        const text = `${route.name} ${route.description} ${route.startLocation} ${route.endLocation}`.toLowerCase();
        const matchesSearch = searchTerm ? text.includes(searchTerm) : true;
        return matchesType && matchesSearch;
      });
      const list = filtered;
      if (!list.length) {
        routeList.style.display = 'none';
        if (noRoutes) noRoutes.style.display = 'block';
        return;
      }
      routeList.style.display = '';
      if (noRoutes) noRoutes.style.display = 'none';
      routeList.innerHTML = list.map(route => {
        const photo = route.photoUrl ? `<img src="${route.photoUrl}" alt="${route.name}" data-viewer-src="${route.photoUrl}">` : `<div>🚴‍♀️</div>`;
        const date = new Date(route.createdAt || route.id).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `
        <div class="route-card">
          ${photo}
          <h3>${route.name}</h3>
          <div class="route-quick-meta">
            <span>${route.type}</span>
            <small>${date}</small>
          </div>
          <button class="btn route-view-btn" data-id="${route.id}">View Details</button>
        </div>
      `;
      }).join('');

      routeList.querySelectorAll('.route-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const routesData = JSON.parse(localStorage.getItem('routes') || '[]');
          const selected = routesData.find(r => String(r.id) === String(id));
          const updated = incrementRouteView(id) || selected;
          openRouteModal(updated);
        });
      });

      // Image click handlers for route cards
      routeList.querySelectorAll('.route-card img[data-viewer-src]').forEach(img => {
        img.addEventListener('click', () => {
          const imageUrl = img.getAttribute('data-viewer-src');
          if (imageUrl) {
            const imageViewerModal = document.getElementById('imageViewerModal');
            const viewerImage = document.getElementById('viewerImage');
            if (imageViewerModal && viewerImage) {
              viewerImage.src = imageUrl;
              imageViewerModal.style.display = 'flex';
            }
          }
        });
      });
    };

    routeModalClose?.addEventListener('click', () => {
      if (routeModal) routeModal.style.display = 'none';
    });
    routeModal?.addEventListener('click', (e) => {
      if (e.target === routeModal) routeModal.style.display = 'none';
    });

    routeSearch?.addEventListener('input', renderRoutesPublic);
    routeTypeFilter?.addEventListener('change', renderRoutesPublic);

    renderRoutesPublic();
  }
  if (profileInfo || myPosts || ownerRequests || ownerApproved || ownerActive) {
    // Check if viewing another user's profile
    const urlParams = new URLSearchParams(window.location.search);
    const viewUserEmail = urlParams.get('view');
    let viewingUser = currentUser;
    let isViewingOther = false;

    if (viewUserEmail && currentUser) {
      const normalizedViewEmail = viewUserEmail.toLowerCase();
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      const viewUser = users.find(u => (u.email || '').toLowerCase() === normalizedViewEmail);
      if (viewUser) {
        viewingUser = viewUser;
        isViewingOther = true;
      }
    }

    if (!currentUser && !viewUserEmail) {
      window.location.href = "login.html";
      return;
    }

    if (profileInfo) {
      const avatar = viewingUser.profilePicUrl
        ? `<img class="profile-img" src="${viewingUser.profilePicUrl}" alt="Avatar" data-viewer-src="${viewingUser.profilePicUrl}">`
        : `<div class="profile-img" style="width:160px;height:160px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#a855f7);margin:-90px auto 1.75rem;display:flex;align-items:center;justify-content:center;font-size:3.5rem;color:white;position:relative;z-index:2;box-shadow:0 20px 50px rgba(0,0,0,0.35);">${(viewingUser.name || 'U').charAt(0).toUpperCase()}</div>`;
      const showRole = viewingUser.role === 'admin';
      const infoCards = [
        { label: 'Email', icon: '📧', value: viewingUser.email || 'Not set' },
        { label: 'Phone', icon: '📱', value: viewingUser.phone || 'Not set' },
        { label: 'Address', icon: '📍', value: viewingUser.address || 'Not set' }
      ].map(info => `
        <div class="profile-info-item">
          <span class="profile-info-label">${info.label}</span>
          <span class="profile-info-value">${info.icon} ${info.value}</span>
        </div>
      `).join('');

      profileInfo.innerHTML = `
        ${avatar}
        <div class="profile-heading-block">
          <h3 style="color:var(--text-main);font-size:1.5rem;margin:0 0 0.25rem 0;font-weight:700;">${viewingUser.name}</h3>
          ${showRole ? `<span style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;text-transform:uppercase;color:#fff;">Admin</span>` : ''}
        </div>
        <div class="profile-info-grid">
          ${infoCards}
        </div>
      `;
    }

      // Hide owner section cards and action buttons when viewing another user
    // This must run outside the profileInfo block to ensure it always executes
      if (isViewingOther) {
        const ownerRequestsCard = document.getElementById('ownerRequestsCard');
        const ownerApprovedCard = document.getElementById('ownerApprovedCard');
        const ownerActiveCard = document.getElementById('ownerActiveCard');
        const profileActions = document.getElementById('profileActions');
        const myPostsCard = document.getElementById('myPostsCard');
        const myPostsModal = document.getElementById('myPostsModal');
      const dashboardOverviewTitle = document.getElementById('dashboardOverviewTitle');
      const dashboardGrid = document.getElementById('dashboardGrid');
        if (ownerRequestsCard) ownerRequestsCard.style.display = 'none';
        if (ownerApprovedCard) ownerApprovedCard.style.display = 'none';
        if (ownerActiveCard) ownerActiveCard.style.display = 'none';
        if (profileActions) profileActions.style.display = 'none';
      const myRentalsBtn = document.getElementById('myRentalsBtn');
      if (myRentalsBtn) myRentalsBtn.style.display = 'none';
      // Hide "My Posted Bikes" card and entire Dashboard Overview section when viewing another user
      if (myPostsCard) myPostsCard.style.display = 'none';
      if (dashboardOverviewTitle) dashboardOverviewTitle.style.display = 'none';
      if (dashboardGrid) dashboardGrid.style.display = 'none';
    } else if (currentUser && profileInfo) {
        // Hide owner sections if user has never posted a bike
        const bikes = JSON.parse(localStorage.getItem("bikes") || "[]");
        const myBikes = bikes.filter(b => b.owner === currentUser.email);
        const hasPostedBikes = myBikes.length > 0;

        if (!hasPostedBikes) {
          const ownerRequestsCard = document.getElementById('ownerRequestsCard');
          const ownerApprovedCard = document.getElementById('ownerApprovedCard');
          const ownerActiveCard = document.getElementById('ownerActiveCard');
          const myPostsCard = document.getElementById('myPostsCard');

          if (ownerRequestsCard) ownerRequestsCard.style.display = 'none';
          if (ownerApprovedCard) ownerApprovedCard.style.display = 'none';
          if (ownerActiveCard) ownerActiveCard.style.display = 'none';
          if (myPostsCard) myPostsCard.style.display = 'none';
        }
      }

    const editProfileBtn = document.getElementById('editProfileBtn');
    const profileEditModal = document.getElementById('profileEditModal');
    const profileEditClose = document.getElementById('profileEditClose');
    const profileEditForm = document.getElementById('profileEditForm');
    const profileEditPhone = document.getElementById('profileEditPhone');
    const profileEditAddress = document.getElementById('profileEditAddress');
    const profileEditImage = document.getElementById('profileEditImage');
    const profileEditCancel = document.getElementById('profileEditCancel');
    const myRentalsBtn = document.getElementById('myRentalsBtn');
    const myRentalsModal = document.getElementById('myRentalsModal');
    const myRentalsClose = document.getElementById('myRentalsClose');
    const chatAction = document.getElementById('chatAction');
    const openChatBtn = document.getElementById('openChatBtn');
    const chatModal = document.getElementById('chatModal');
    const chatModalClose = document.getElementById('chatModalClose');
    const chatModalName = document.getElementById('chatModalName');
    const chatMessagesEl = document.getElementById('chatMessages');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const messageCenterCard = document.getElementById('messageCenterCard');
    const chatThreadList = document.getElementById('chatThreadList');
    const chatBadge = document.getElementById('chatBadge');
    const contactAdminCard = document.getElementById('contactAdminCard');
    const contactAdminModal = document.getElementById('contactAdminModal');
    const contactAdminClose = document.getElementById('contactAdminClose');
    const contactAdminForm = document.getElementById('contactAdminForm');
    const contactAdminSubject = document.getElementById('contactAdminSubject');
    const contactAdminMessage = document.getElementById('contactAdminMessage');
    const contactAdminFeedback = document.getElementById('contactAdminFeedback');
    const contactAdminCancel = document.getElementById('contactAdminCancel');
    const populateProfileEditForm = () => {
      if (!currentUser) return;
      if (profileEditPhone) profileEditPhone.value = currentUser.phone || '';
      if (profileEditAddress) profileEditAddress.value = currentUser.address || '';
      if (profileEditImage) profileEditImage.value = '';
    };

    const showProfileEditModal = () => {
      if (!currentUser) {
        window.location.href = 'login.html';
        return;
      }
      if (!profileEditModal) return;
      populateProfileEditForm();
      profileEditModal.style.display = 'flex';
    };

    const hideProfileEditModal = () => {
      if (!profileEditModal) return;
      profileEditModal.style.display = 'none';
      if (profileEditForm) profileEditForm.reset();
    };

    editProfileBtn?.addEventListener('click', showProfileEditModal);
    profileEditClose?.addEventListener('click', hideProfileEditModal);
    profileEditCancel?.addEventListener('click', hideProfileEditModal);
    profileEditModal?.addEventListener('click', (event) => {
      if (event.target === profileEditModal) hideProfileEditModal();
    });

    const showMyRentalsModal = () => {
      if (!currentUser) {
        window.location.href = 'login.html';
        return;
      }
      if (myRentalsModal) myRentalsModal.style.display = 'flex';
    };

    const hideMyRentalsModal = () => {
      if (!myRentalsModal) return;
      myRentalsModal.style.display = 'none';
    };

    myRentalsBtn?.addEventListener('click', showMyRentalsModal);
    myRentalsClose?.addEventListener('click', hideMyRentalsModal);
    myRentalsModal?.addEventListener('click', (event) => {
      if (event.target === myRentalsModal) hideMyRentalsModal();
    });

    if (profileEditForm) {
      profileEditForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!currentUser) {
          window.location.href = 'login.html';
          return;
        }
        const phone = (profileEditPhone?.value || '').trim();
        const address = (profileEditAddress?.value || '').trim();
        const users = JSON.parse(localStorage.getItem('users')) || [];
        const idx = users.findIndex(user => (user.email || '').toLowerCase() === (currentUser.email || '').toLowerCase());
        if (idx === -1) {
          showNotification('Profile Missing', 'We could not find your account. Please log in again.', 'error');
          localStorage.removeItem('currentUser');
          window.location.href = 'login.html';
          return;
        }

        const persistProfile = (profilePicUrl) => {
          const updatedUser = { ...users[idx], phone, address };
          if (profilePicUrl) updatedUser.profilePicUrl = profilePicUrl;
          users[idx] = updatedUser;
          if (!safeSetJSON('users', users)) return;
          if (!safeSetJSON('currentUser', updatedUser)) return;
          showNotification('Profile Updated', 'Your contact details were saved successfully.', 'success');
          setTimeout(() => window.location.reload(), 1200);
        };

        const file = profileEditImage?.files && profileEditImage.files[0];
        if (file) {
          compressImageFile(file).then((dataUrl) => {
            persistProfile(dataUrl);
          }).catch(() => {
            showNotification('Image Error', 'Failed to process profile picture. Please try another image.', 'error');
          });
        } else {
          persistProfile(null);
        }
      });
    }

    let chatTargetEmail = null;
    let chatTargetName = '';

    const renderChat = () => {
      if (!chatTargetEmail || !currentUser || !chatMessagesEl) {
        if (chatMessagesEl) {
          chatMessagesEl.innerHTML = `<p class="chat-empty">Select a conversation to start messaging.</p>`;
        }
        if (chatInput) chatInput.disabled = true;
        return;
      }
      const history = getChatHistory(currentUser.email, chatTargetEmail);
      try {
        const all = JSON.parse(localStorage.getItem(DIRECT_MESSAGES_KEY) || '{}');
        const key = buildChatKey(currentUser.email, chatTargetEmail);
        const updatedHistory = history.map(msg => {
          if (!msg.seenBy) msg.seenBy = [];
          if (!msg.seenBy.includes(currentUser.email)) {
            msg.seenBy = [...msg.seenBy, currentUser.email];
          }
          return msg;
        });
        if (all[key]) {
          all[key] = updatedHistory;
          safeSetJSON(DIRECT_MESSAGES_KEY, all);
        }
      } catch (_) {
        // ignore
      }
      if (!history.length) {
        chatMessagesEl.innerHTML = `<p class="chat-empty">Start the conversation by saying hello.</p>`;
      } else {
        chatMessagesEl.innerHTML = history.map(msg => {
          const isMe = msg.sender === currentUser.email;
          const when = new Date(msg.timestamp || msg.id || Date.now()).toLocaleString();
          return `
            <div class="chat-bubble ${isMe ? 'me' : 'them'}">
              <div>${escapeHTML(msg.text || '')}</div>
              <time>${escapeHTML(when)}</time>
            </div>
          `;
        }).join('');
      }
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      if (chatInput) chatInput.disabled = false;
      if (currentUser) {
        updateChatNavBadge(getChatThreadsForUser(currentUser.email));
      }
    };

    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!chatTargetEmail || !currentUser) return;
        const text = chatInput.value.trim();
        if (!text) return;
        appendChatMessage(currentUser.email, chatTargetEmail, {
          id: Date.now(),
          sender: currentUser.email,
          text,
          timestamp: Date.now(),
          seenBy: [currentUser.email]
        });
        chatInput.value = '';
        renderChat();
        const threads = getChatThreadsForUser(currentUser.email);
        if (!isViewingOther) {
          populateThreads(threads);
        } else {
          updateChatNavBadge(threads);
        }
      });
    }

    const openChatWith = (targetEmail, targetName) => {
      if (!chatModal || !currentUser || !targetEmail) return;
      chatTargetEmail = targetEmail;
      chatTargetName = targetName || targetEmail;
      if (chatModalName) chatModalName.textContent = chatTargetName;
      chatModal.style.display = 'flex';
      renderChat();
    };

    const closeChat = () => {
      if (chatModal) chatModal.style.display = 'none';
    };

    chatModalClose?.addEventListener('click', closeChat);
    chatModal?.addEventListener('click', (e) => {
      if (e.target === chatModal) closeChat();
    });

    const populateThreads = (threads) => {
      if (!chatThreadList) return;
      const currentEmailLower = (currentUser?.email || '').toLowerCase();
      const normalizeList = (list) => Array.isArray(list)
        ? list.map(email => (email || '').toLowerCase())
        : [];
      const isThreadUnread = (thread) => {
        if (!currentEmailLower) return false;
        const lastMsg = thread.lastMessage;
        if (!lastMsg) return false;
        const senderLower = (lastMsg.sender || '').toLowerCase();
        if (!senderLower || senderLower === currentEmailLower) return false;
        const seenList = normalizeList(lastMsg.seenBy);
        return !seenList.includes(currentEmailLower);
      };
      const unreadCount = threads.filter(isThreadUnread).length;
      updateChatNavBadge(threads);
      if (chatBadge) {
        if (unreadCount > 0) {
          chatBadge.style.display = 'inline-flex';
          chatBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
          chatBadge.style.display = 'none';
        }
      }
      if (!threads.length) {
        chatThreadList.innerHTML = `<p class="chat-empty">No messages yet.</p>`;
        return;
      }
      chatThreadList.innerHTML = threads.map(thread => {
        const isUnread = isThreadUnread(thread);
        const lastText = thread.lastMessage?.text ? escapeHTML(thread.lastMessage.text.slice(0, 90)) : 'New message';
        const when = thread.lastTimestamp ? new Date(thread.lastTimestamp).toLocaleString() : '';
        const profileLink = `profile.html?view=${encodeURIComponent(thread.otherEmail || '')}`;
        return `
          <div class="chat-thread-item${isUnread ? ' unread' : ''}" data-email="${thread.otherEmail}" data-name="${escapeHTML(thread.otherName || thread.otherEmail)}">
            <div class="chat-thread-meta">
              <h4>${escapeHTML(thread.otherName || thread.otherEmail)}</h4>
              <p>${lastText}</p>
              <div class="chat-thread-actions">
                <a href="${profileLink}" class="chat-thread-profile" title="View profile of ${escapeHTML(thread.otherName || thread.otherEmail)}" target="_blank" rel="noopener">👤 View Profile</a>
              </div>
            </div>
            <div class="chat-thread-time">${escapeHTML(when)}</div>
          </div>
        `;
      }).join('');

      chatThreadList.querySelectorAll('.chat-thread-item').forEach(item => {
        item.addEventListener('click', () => {
          const email = item.getAttribute('data-email');
          const name = item.getAttribute('data-name');
          openChatWith(email, name);
        });
      });
    };

    const backToProfileBtn = document.getElementById('backToProfileBtn');
    if (isViewingOther && currentUser && viewingUser && viewingUser.email && chatAction) {
      chatAction.style.display = 'block';
      if (backToProfileBtn) backToProfileBtn.style.display = 'inline-block';
      openChatBtn?.addEventListener('click', () => openChatWith(viewingUser.email, viewingUser.name || viewingUser.email));
    } else if (chatAction) {
      chatAction.style.display = 'none';
      if (backToProfileBtn) backToProfileBtn.style.display = 'none';
    }

    const profileSetupRequested = urlParams.get('profileSetup');
    if (profileSetupRequested && !isViewingOther) {
      showProfileEditModal();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('profileSetup');
        window.history.replaceState({}, '', url);
      } catch (_) {
        // ignore history errors
      }
    }

    if (!isViewingOther && currentUser && messageCenterCard && chatThreadList) {
      const threads = getChatThreadsForUser(currentUser.email);
      if (threads.length) {
        messageCenterCard.style.display = 'block';
        populateThreads(threads);
      } else {
        messageCenterCard.style.display = 'block';
        chatThreadList.innerHTML = `<p class="chat-empty">No messages yet.</p>`;
      }
    } else if (messageCenterCard) {
      messageCenterCard.style.display = 'none';
    }

    const shouldShowContactAdmin = !isViewingOther
      && currentUser
      && (currentUser.role || 'user').toLowerCase() !== 'admin';
    if (contactAdminCard) {
      contactAdminCard.style.display = shouldShowContactAdmin ? 'flex' : 'none';
    }

    const resetContactAdminFeedback = () => {
      if (!contactAdminFeedback) return;
      contactAdminFeedback.textContent = '';
      contactAdminFeedback.classList.remove('success', 'error');
    };

    const hideContactAdminModal = () => {
      if (!contactAdminModal) return;
      contactAdminModal.style.display = 'none';
      contactAdminForm?.reset();
      resetContactAdminFeedback();
    };

    const openContactAdminModal = () => {
      if (!currentUser) {
        window.location.href = 'login.html';
        return;
      }
      if (!contactAdminModal) return;
      resetContactAdminFeedback();
      contactAdminModal.style.display = 'flex';
      contactAdminSubject?.focus();
    };

    contactAdminCard?.addEventListener('click', openContactAdminModal);
    contactAdminCard?.addEventListener('keypress', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openContactAdminModal();
      }
    });
    contactAdminClose?.addEventListener('click', hideContactAdminModal);
    contactAdminCancel?.addEventListener('click', hideContactAdminModal);
    contactAdminModal?.addEventListener('click', (event) => {
      if (event.target === contactAdminModal) hideContactAdminModal();
    });

    if (contactAdminForm) {
      contactAdminForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!currentUser) {
          window.location.href = 'login.html';
          return;
        }
        const subject = (contactAdminSubject?.value || '').trim();
        const message = (contactAdminMessage?.value || '').trim();
        if (!message) {
          if (contactAdminFeedback) {
            contactAdminFeedback.textContent = 'Please include a short message for the admin.';
            contactAdminFeedback.classList.remove('success');
            contactAdminFeedback.classList.add('error');
          }
          return;
        }
        const payload = subject ? `Subject: ${subject}\n${message}` : message;
        appendChatMessage(currentUser.email, ADMIN_EMAIL, {
          id: Date.now(),
          sender: currentUser.email,
          text: payload,
          timestamp: Date.now(),
          seenBy: [currentUser.email]
        });
        if (contactAdminFeedback) {
          contactAdminFeedback.textContent = 'Message sent! Check your inbox for replies.';
          contactAdminFeedback.classList.remove('error');
          contactAdminFeedback.classList.add('success');
        }
        const threads = currentUser ? getChatThreadsForUser(currentUser.email) : [];
        if (!isViewingOther && messageCenterCard && chatThreadList) {
          messageCenterCard.style.display = 'block';
          populateThreads(threads);
        } else {
          updateChatNavBadge(threads);
        }
        setTimeout(() => {
          hideContactAdminModal();
        }, 1200);
      });
    }

    if (myPosts && !isViewingOther) {
      const bikes = JSON.parse(localStorage.getItem("bikes")) || [];
      const mine = bikes.filter(b => b.owner === viewingUser.email);
      const myPostsContent = document.getElementById('myPostsContent');
      const myPostsCount = document.getElementById('myPostsCount');
      if (myPostsCount) myPostsCount.textContent = mine.length;
      if (myPostsContent) {
        myPostsContent.innerHTML = mine.length ? mine.map(b => {
          const displayName = b.name || b.model || "Bike";
          const displayRate = (b.rate ?? b.price ?? "");
          const displayDesc = b.description ? `<p>${b.description}</p>` : "";
          const displayLoc = b.location ? `<p><strong>Location:</strong> ${b.location}</p>` : "";
          const img = b.imageUrl ? `<img class="card-img bike-image" src="${b.imageUrl}" alt="${displayName}" data-img="${b.imageUrl}" data-viewer-src="${b.imageUrl}">` : "";
          return `
        <div class="card">
          ${img}
          <h3>${displayName}</h3>
          ${displayDesc}
          <p>₱${displayRate}/hour</p>
          ${displayLoc}
          <p>Status: ${b.available ? "Available" : "Rented"}</p>
          ${!isViewingOther ? `
          <div>
            <button class="btn editBikeBtn" data-id="${b.id}">Edit</button>
            <button class="btn deleteBikeBtn" data-id="${b.id}" style="margin-left:8px;">Delete</button>
          </div>
          ` : ''}
        </div>`;
        }).join("") : `<p>No bikes posted yet.</p>`;

        // Make bike images clickable in profile page
        const imageViewerModal = document.getElementById('imageViewerModal');
        const imageViewerClose = document.getElementById('imageViewerClose');
        const viewerImage = document.getElementById('viewerImage');

        if (imageViewerModal && imageViewerClose && viewerImage) {
          const showImageViewer = (imageUrl) => {
            viewerImage.src = imageUrl;
            imageViewerModal.style.display = 'flex';
          };

          const hideImageViewer = () => {
            imageViewerModal.style.display = 'none';
          };

          imageViewerClose.onclick = hideImageViewer;

          // Click outside to close
          imageViewerModal.addEventListener('click', (e) => {
            if (e.target === imageViewerModal) hideImageViewer();
          });

          // Make bike images clickable
          myPostsContent.querySelectorAll('.bike-image').forEach(img => {
            img.addEventListener('click', () => {
              const imageUrl = img.getAttribute('data-img');
              if (imageUrl) showImageViewer(imageUrl);
            });
          });
        }
      }

      // Edit/Delete handlers
      const editModal = document.getElementById('editModal');
      const editClose = document.getElementById('editClose');
      const editName = document.getElementById('editName');
      const editCategory = document.getElementById('editCategory');
      const editDescription = document.getElementById('editDescription');
      const editRate = document.getElementById('editRate');
      const editLocation = document.getElementById('editLocation');
      const editAvailable = document.getElementById('editAvailable');
      const editImages = document.getElementById('editImages');
      const editImagePreview = document.getElementById('editImagePreview');
      const editCancel = document.getElementById('editCancel');
      const editSave = document.getElementById('editSave');

      let editingBikeId = null;
      const hideEdit = () => { if (editModal) editModal.style.display = 'none'; };
      const showEdit = () => { if (editModal) editModal.style.display = 'flex'; };

      // Image preview for edit
      if (editImages && editImagePreview) {
        editImages.addEventListener("change", (e) => {
          const files = e.target.files;
          if (files.length > 0) {
            editImagePreview.style.display = "block";
            editImagePreview.innerHTML = "<strong>Preview:</strong><div style='display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-top:10px;'></div>";
            const previewContainer = editImagePreview.querySelector("div");

            Array.from(files).forEach((file) => {
              const reader = new FileReader();
              reader.onload = (event) => {
                const img = document.createElement("img");
                img.src = event.target.result;
                img.style.width = "100%";
                img.style.height = "100px";
                img.style.objectFit = "cover";
                img.style.borderRadius = "5px";
                img.style.border = "2px solid #ddd";
                previewContainer.appendChild(img);
              };
              reader.readAsDataURL(file);
            });
          } else {
            editImagePreview.style.display = "none";
          }
        });
      }

      const openEdit = (bike) => {
        editingBikeId = bike.id;
        editName.value = bike.name || bike.model || '';
        if (editCategory) editCategory.value = bike.category || '';
        editDescription.value = bike.description || '';
        editRate.value = (bike.rate ?? bike.price ?? 0);
        editLocation.value = bike.location || '';
        editAvailable.checked = !!bike.available;
        if (editImages) editImages.value = '';
        if (editImagePreview) editImagePreview.style.display = 'none';
        showEdit();
      };

      if (editClose) editClose.onclick = hideEdit;
      if (editCancel) editCancel.onclick = hideEdit;

      myPostsContent.querySelectorAll('.editBikeBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const allBikes = JSON.parse(localStorage.getItem('bikes')) || [];
          const bike = allBikes.find(x => String(x.id) === String(id) && x.owner === currentUser.email);
          if (!bike) return;
          openEdit(bike);
          if (editSave) {
            editSave.onclick = () => {
              const allBikesSave = JSON.parse(localStorage.getItem('bikes')) || [];
              const idx = allBikesSave.findIndex(x => String(x.id) === String(editingBikeId) && x.owner === currentUser.email);
              if (idx === -1) return hideEdit();
              const baseUpdate = {
                ...allBikesSave[idx],
                name: editName.value.trim(),
                category: editCategory ? (editCategory.value || "Other") : (allBikesSave[idx].category || "Other"),
                description: editDescription.value.trim(),
                rate: parseFloat(editRate.value) || 0,
                location: editLocation.value.trim(),
                available: !!editAvailable.checked
              };

              const files = editImages && editImages.files ? Array.from(editImages.files) : [];

              const finalize = (updated) => {
                allBikesSave[idx] = updated;
                if (!safeSetJSON('bikes', allBikesSave)) return;
                hideEdit();
                showNotification("Bike Updated", "Your bike information has been updated successfully!", "success");
                setTimeout(() => location.reload(), 1500);
              };

              if (files.length > 0) {
                Promise.all(files.map(file => compressImageFile(file)))
                  .then((imageUrls) => {
                    finalize({
                      ...baseUpdate,
                      imageUrls,
                      imageUrl: imageUrls[0]
                    });
                  })
                  .catch((error) => {
                    console.error('Failed to process images', error);
                    showNotification("Image Error", "Failed to process new images. Please try again.", "error");
                  });
              } else {
                finalize(baseUpdate);
              }
            };
          }
        });
      });

      myPostsContent.querySelectorAll('.deleteBikeBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          if (!confirm('Are you sure you want to delete this bike?')) return;
          const allBikes = JSON.parse(localStorage.getItem('bikes')) || [];
          const remaining = allBikes.filter(x => !(String(x.id) === String(id) && x.owner === currentUser.email));
          if (!safeSetJSON('bikes', remaining)) return;
          // Cleanup rentals for this bike
          const rentals = JSON.parse(localStorage.getItem('rentals')) || [];
          const rentalsRemaining = rentals.filter(r => String(r.bikeId) !== String(id));
          if (!safeSetJSON('rentals', rentalsRemaining)) return;
          showNotification("Bike Deleted", "Your bike has been removed from listings.", "info");
          setTimeout(() => location.reload(), 1500);
        });
      });
    }

    // Only show owner sections if viewing own profile
    if (ownerRequests && !isViewingOther) {
      const rentals = JSON.parse(localStorage.getItem("rentals")) || [];
      const bikes = JSON.parse(localStorage.getItem("bikes")) || [];
      const myBikeIds = new Set(bikes.filter(b => b.owner === currentUser.email).map(b => String(b.id)));
      const pending = rentals.filter(r => r.status === "Pending" && myBikeIds.has(String(r.bikeId)));
      const ownerRequestsContent = document.getElementById('ownerRequestsContent');
      const ownerRequestsCount = document.getElementById('ownerRequestsCount');
      if (ownerRequestsCount) ownerRequestsCount.textContent = pending.length;
      if (ownerRequestsContent) {
        ownerRequestsContent.innerHTML = pending.length ? pending.map(r => {
          const bike = bikes.find(b => String(b.id) === String(r.bikeId));
          const displayName = bike?.name || bike?.model || "Bike";
          const rate = r.rate ?? (bike?.rate ?? bike?.price ?? 0);
          const hours = r.hours ?? 1;
          const total = r.total ?? (rate * hours);
          return `
        <div class="card">
          <h3>${displayName}</h3>
          <p><strong>Renter:</strong> ${r.renter}</p>
          <p><strong>Hours:</strong> ${hours}</p>
          <p><strong>Total:</strong> ₱${total}</p>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
            <a href="profile.html?view=${encodeURIComponent(r.renter)}" class="btn btn-outline" style="text-decoration:none;">👤 View Profile</a>
            <button class="btn approveBtn" data-id="${r.id}">Approve</button>
            <button class="btn declineBtn" data-id="${r.id}">Decline</button>
          </div>
        </div>`;
        }).join("") : `<p>No pending requests.</p>`;

        ownerRequestsContent.querySelectorAll('.approveBtn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const rentalsData = JSON.parse(localStorage.getItem('rentals')) || [];
            const bikesData = JSON.parse(localStorage.getItem('bikes')) || [];
            const reqIdx = rentalsData.findIndex(x => String(x.id) === String(id));
            if (reqIdx === -1) return;
            const req = rentalsData[reqIdx];
            // Mark bike as unavailable when approved (reserved for this renter)
            const bikeIdx = bikesData.findIndex(b => String(b.id) === String(req.bikeId));
            if (bikeIdx !== -1) {
              bikesData[bikeIdx].available = false;
              if (!safeSetJSON('bikes', bikesData)) return;
            }
            // convert request to approved (not active yet - waiting for pickup)
            rentalsData[reqIdx] = {
              ...req,
              status: 'Approved'
            };
            if (!safeSetJSON('rentals', rentalsData)) return;
            showNotification("Request Approved", "Renter will be notified to set pickup schedule.", "success");
            setTimeout(() => location.reload(), 1500);
          });
        });

        ownerRequestsContent.querySelectorAll('.declineBtn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const rentalsData = JSON.parse(localStorage.getItem('rentals')) || [];
            const updated = rentalsData.filter(x => String(x.id) !== String(id));
            if (!safeSetJSON('rentals', updated)) return;
            showNotification("Request Declined", "The rental request has been declined.", "info");
            setTimeout(() => location.reload(), 1500);
          });
        });
      }
    }

    // Approved Rentals (Owner view - waiting for pickup)
    const ownerApproved = document.getElementById('ownerApproved');
    if (ownerApproved && !isViewingOther) {
      const rentals = JSON.parse(localStorage.getItem('rentals') || '[]');
      const bikes = JSON.parse(localStorage.getItem('bikes') || '[]');
      const myBikeIds = new Set(bikes.filter(b => b.owner === currentUser.email).map(b => String(b.id)));
      const approved = rentals.filter(r => r.status === 'Approved' && myBikeIds.has(String(r.bikeId)));
      const ownerApprovedContent = document.getElementById('ownerApprovedContent');
      const ownerApprovedCount = document.getElementById('ownerApprovedCount');
      if (ownerApprovedCount) ownerApprovedCount.textContent = approved.length;
      const fmt = (ts) => {
        try { return new Date(ts).toLocaleString(); } catch { return ''; }
      };
      if (ownerApprovedContent) {
        ownerApprovedContent.innerHTML = approved.length ? approved.map(r => {
          const bike = bikes.find(b => String(b.id) === String(r.bikeId));
          const displayName = bike?.name || bike?.model || 'Bike';
          const rate = r.rate ?? (bike?.rate ?? bike?.price ?? 0);
          const hours = r.hours ?? 1;
          const total = r.total ?? (rate * hours);
          const hasSchedule = r.pickupSchedule && (typeof r.pickupSchedule === 'number' || typeof r.pickupSchedule === 'string');
          const scheduleInfo = hasSchedule
            ? `<p><strong>Pickup Scheduled:</strong> ${fmt(Number(r.pickupSchedule))}</p>`
            : '<p><em>Waiting for renter to set pickup schedule...</em></p>';
          const startBtn = hasSchedule
            ? `<button class="btn startRentalBtn" data-id="${r.id}">Start Rental</button>`
            : '';
          return `
        <div class="card">
          <h3>${displayName}</h3>
          <p><strong>Renter:</strong> ${r.renter}</p>
          <p><strong>Hours:</strong> ${hours}</p>
          <p><strong>Total:</strong> ₱${total}</p>
          ${scheduleInfo}
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
            <a href="profile.html?view=${encodeURIComponent(r.renter)}" class="btn btn-outline" style="text-decoration:none;">👤 View Profile</a>
            ${startBtn}
          </div>
        </div>`;
        }).join('') : '<p>No approved rentals.</p>';

        ownerApprovedContent.querySelectorAll('.startRentalBtn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            if (!confirm('Start rental now? The bike has been picked up.')) return;
            const rentalsData = JSON.parse(localStorage.getItem('rentals') || '[]');
            const bikesData = JSON.parse(localStorage.getItem('bikes') || '[]');
            const idx = rentalsData.findIndex(r => String(r.id) === String(id));
            if (idx === -1) return;
            const rental = rentalsData[idx];
            // Mark bike as unavailable now that rental starts
            const bikeIdx = bikesData.findIndex(b => String(b.id) === String(rental.bikeId));
            if (bikeIdx !== -1) {
              bikesData[bikeIdx].available = false;
              if (!safeSetJSON('bikes', bikesData)) return;
            }
            rentalsData[idx] = {
              ...rentalsData[idx],
              status: 'Active',
              startTime: Date.now()
            };
            if (!safeSetJSON('rentals', rentalsData)) return;
            showNotification("Rental Started", "The rental timer has started. Bike is now in use.", "success");
            setTimeout(() => location.reload(), 1500);
          });
        });
      }
    }

    // Active Rentals (Owner view)
    const ownerActive = document.getElementById('ownerActive');
    if (ownerActive && !isViewingOther) {
      const rentals = JSON.parse(localStorage.getItem('rentals')) || [];
      const bikes = JSON.parse(localStorage.getItem('bikes')) || [];
      const myBikeIds = new Set(bikes.filter(b => b.owner === currentUser.email).map(b => String(b.id)));
      const active = rentals.filter(r => r.status === 'Active' && myBikeIds.has(String(r.bikeId)));
      const ownerActiveContent = document.getElementById('ownerActiveContent');
      const ownerActiveCount = document.getElementById('ownerActiveCount');
      if (ownerActiveCount) ownerActiveCount.textContent = active.length;
      const fmt = (ts) => {
        try { return new Date(ts).toLocaleString(); } catch { return ''; }
      };
      if (ownerActiveContent) {
        ownerActiveContent.innerHTML = active.length ? active.map(r => {
          const bike = bikes.find(b => String(b.id) === String(r.bikeId));
          const displayName = bike?.name || bike?.model || 'Bike';
          const rate = r.rate ?? (bike?.rate ?? bike?.price ?? 0);
          const hours = r.hours ?? 1;
          const total = r.total ?? (rate * hours);
          const start = r.startTime || Date.now();
          const end = start + (hours * 60 * 60 * 1000);
          return `
        <div class="card">
          <h3>${displayName}</h3>
          <p><strong>Renter:</strong> ${r.renter}</p>
          <p><strong>Start Time:</strong> ${fmt(start)}</p>
          <p><strong>Duration:</strong> ${hours} hour(s)</p>
          <p><strong>Estimated End:</strong> ${fmt(end)}</p>
          <p><strong>Total Paid:</strong> ₱${total}</p>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
            <a href="profile.html?view=${encodeURIComponent(r.renter)}" class="btn btn-outline" style="text-decoration:none;">👤 View Profile</a>
            <button class="btn returnBtn" data-id="${r.id}">Mark as Returned</button>
            <button class="btn extendBtn" data-id="${r.id}">Add Extra Time</button>
          </div>
        </div>`;
        }).join('') : '<p>No active rentals.</p>';

        ownerActiveContent.querySelectorAll('.returnBtn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const rentalsData = JSON.parse(localStorage.getItem('rentals')) || [];
            const bikesData = JSON.parse(localStorage.getItem('bikes')) || [];
            const idx = rentalsData.findIndex(x => String(x.id) === String(id));
            if (idx === -1) return;
            const rental = rentalsData[idx];
            const bikeIdx = bikesData.findIndex(b => String(b.id) === String(rental.bikeId));
            if (bikeIdx !== -1) {
              bikesData[bikeIdx].available = true;
              if (!safeSetJSON('bikes', bikesData)) return;
            }
            // remove or mark completed; we'll remove
            const updated = rentalsData.filter(x => String(x.id) !== String(id));
            if (!safeSetJSON('rentals', updated)) return;
            showNotification("Bike Returned", "The bike has been returned and is now available.", "success");
            setTimeout(() => location.reload(), 1500);
          });
        });

        ownerActiveContent.querySelectorAll('.extendBtn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const extra = parseInt(prompt('Add extra hours:', '1') || '0', 10);
            if (!extra || extra < 1) return;
            const rentalsData = JSON.parse(localStorage.getItem('rentals')) || [];
            const idx = rentalsData.findIndex(x => String(x.id) === String(id));
            if (idx === -1) return;
            const r = rentalsData[idx];
            const newHours = (r.hours || 0) + extra;
            const rate = r.rate || 0;
            rentalsData[idx] = { ...r, hours: newHours, total: (rate * newHours) };
            if (!safeSetJSON('rentals', rentalsData)) return;
            showNotification("Rental Extended", `Rental extended by ${extra} hour(s). New total: ₱${rate * newHours}`, "info");
            setTimeout(() => location.reload(), 1500);
          });
        });
      }
    }

    // Card click handlers to open modals
    const myPostsCard = document.getElementById('myPostsCard');
    const myPostsModal = document.getElementById('myPostsModal');
    const myPostsModalClose = document.getElementById('myPostsModalClose');

    const ownerRequestsCard = document.getElementById('ownerRequestsCard');
    const ownerRequestsModal = document.getElementById('ownerRequestsModal');
    const ownerRequestsModalClose = document.getElementById('ownerRequestsModalClose');

    const ownerActiveCard = document.getElementById('ownerActiveCard');
    const ownerActiveModal = document.getElementById('ownerActiveModal');
    const ownerActiveModalClose = document.getElementById('ownerActiveModalClose');

    const ownerApprovedCard = document.getElementById('ownerApprovedCard');
    const ownerApprovedModal = document.getElementById('ownerApprovedModal');
    const ownerApprovedModalClose = document.getElementById('ownerApprovedModalClose');

    if (myPostsCard && myPostsModal) {
      myPostsCard.addEventListener('click', () => {
        myPostsModal.style.display = 'flex';
      });
      if (myPostsModalClose) {
        myPostsModalClose.onclick = () => { myPostsModal.style.display = 'none'; };
      }
      myPostsModal.addEventListener('click', (e) => {
        if (e.target === myPostsModal) myPostsModal.style.display = 'none';
      });
    }

    if (ownerRequestsCard && ownerRequestsModal) {
      ownerRequestsCard.addEventListener('click', () => {
        ownerRequestsModal.style.display = 'flex';
      });
      if (ownerRequestsModalClose) {
        ownerRequestsModalClose.onclick = () => { ownerRequestsModal.style.display = 'none'; };
      }
      ownerRequestsModal.addEventListener('click', (e) => {
        if (e.target === ownerRequestsModal) ownerRequestsModal.style.display = 'none';
      });
    }

    if (ownerActiveCard && ownerActiveModal) {
      ownerActiveCard.addEventListener('click', () => {
        ownerActiveModal.style.display = 'flex';
      });
      if (ownerActiveModalClose) {
        ownerActiveModalClose.onclick = () => { ownerActiveModal.style.display = 'none'; };
      }
      ownerActiveModal.addEventListener('click', (e) => {
        if (e.target === ownerActiveModal) ownerActiveModal.style.display = 'none';
      });
    }

    if (ownerApprovedCard && ownerApprovedModal) {
      ownerApprovedCard.addEventListener('click', () => {
        ownerApprovedModal.style.display = 'flex';
      });
      if (ownerApprovedModalClose) {
        ownerApprovedModalClose.onclick = () => { ownerApprovedModal.style.display = 'none'; };
      }
      ownerApprovedModal.addEventListener('click', (e) => {
        if (e.target === ownerApprovedModal) ownerApprovedModal.style.display = 'none';
      });
    }
  }
});