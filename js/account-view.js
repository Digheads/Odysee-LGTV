// ---------------------------------------------------------------------------
// Account views: Device Flow Login & Profile / Settings
// (ES5 compatible for webOS 2.0+)
// ---------------------------------------------------------------------------

var AccountView = (function () {
    function renderLogin(containerEl, onLoginSuccess) {
        if (!containerEl) {
            return;
        }

        containerEl.innerHTML = '<div class="login-card">' +
            '<h2 class="login-title">Log in to your Odysee account</h2>' +
            '<p class="login-step">1. Go to the following address on your phone or computer:</p>' +
            '<div class="login-url">odysee.com/$/activate</div>' +
            '<p class="login-step">2. Enter this activation code:</p>' +
            '<div class="login-code-box" id="login-code-box">....-....</div>' +
            '<div class="login-status" id="login-status-box">' +
            '<span class="login-spinner"></span><span class="login-status-text">Waiting for confirmation on your device...</span>' +
            '</div>' +
            '<button class="focusable btn-login-action" id="btn-login-refresh" style="display:none;">Request a new code</button>' +
            '</div>';

        SpatialNavigation.refresh();

        Auth.startDeviceFlow(
            function (info) {
                var codeBox = document.getElementById('login-code-box');
                var refreshBtn = document.getElementById('btn-login-refresh');

                if (codeBox) {
                    codeBox.textContent = info.userCode;
                }
                if (refreshBtn) {
                    refreshBtn.style.display = 'none';
                }
            },
            function (user) {
                var statusBox = document.getElementById('login-status-box');

                if (statusBox) {
                    statusBox.innerHTML = '<span style="color:#4ade80;">\u2713 Successful login!</span>';
                }
                setTimeout(function () {
                    if (typeof onLoginSuccess === 'function') {
                        onLoginSuccess(user);
                    }
                }, 1200);
            },
            function (err) {
                var statusBox = document.getElementById('login-status-box');
                var refreshBtn = document.getElementById('btn-login-refresh');

                if (statusBox) {
                    statusBox.innerHTML = '<span style="color:#f87171;">' + (err.message || 'An activation error occurred.') + '</span>';
                }
                if (refreshBtn) {
                    refreshBtn.style.display = 'inline-block';
                    SpatialNavigation.refresh();
                    refreshBtn.onclick = function () {
                        renderLogin(containerEl, onLoginSuccess);
                    };
                }
            }
        );
    }

    function renderProfile(containerEl, onLogout) {
        var user = Auth.getUser() || {};
        var settings = Auth.getSettings() || {
            hideMature: true,
            hideShorts: true,
            hideYoutube: false
        };

        var rawAvatar = Auth.getAvatarUrl() || (user.avatarUrl || 'icons/spaceman.png');
        var avatarSrc = Utils.getAvatarSrc(rawAvatar, 160);
        var isSpaceman = (!avatarSrc || avatarSrc === 'icons/spaceman.png');
        var chName = user ? (user.channelName || '') : '';
        var avatarColor = isSpaceman ? Utils.getAvatarColor(chName) : 'transparent';

        var displayName = user.channelName || (user.email ? user.email.split('@')[0] : 'Odysee User');
        var emailDisplay = user.email || '';
        var followersText = (user.followers || 0) + ' followers';

        var wrapStyle = isSpaceman ? ' style="background-color: ' + avatarColor + ';"' : '';
        var imgStyle = isSpaceman ? ' style="background-color: ' + avatarColor + ';"' : '';

        var html;
        var logoutBtn;

        function setupToggle(btnId, settingKey) {
            var btn = document.getElementById(btnId);

            if (!btn) {
                return;
            }
            btn.addEventListener('click', function () {
                var currentVal = !!settings[settingKey];
                var nextVal = !currentVal;

                settings[settingKey] = nextVal;
                Auth.updateSetting(settingKey, nextVal);
                btn.textContent = nextVal ? 'ON' : 'OFF';
                if (nextVal) {
                    btn.classList.add('toggle-active');
                } else {
                    btn.classList.remove('toggle-active');
                }
            });
        }

        if (!containerEl) {
            return;
        }

        if (displayName.indexOf('@') !== 0 && user.channelName) {
            displayName = '@' + displayName;
        }

        html = '<div class="profile-view">' +
            '<div class="profile-header-card">' +
            '<div class="profile-avatar-wrap"' + wrapStyle + '>' +
            '<img src="' + avatarSrc + '" class="profile-avatar-img"' + imgStyle + ' alt="Avatar" onerror="this.src=\'icons/spaceman.png\'">' +
            '</div>' +
            '<div class="profile-meta-wrap">' +
            '<div class="profile-display-name">' + Utils.escapeHtml(displayName) + '</div>' +
            (emailDisplay ? '<div class="profile-email">' + Utils.escapeHtml(emailDisplay) + '</div>' : '') +
            '<div class="profile-followers-badge">' + followersText + '</div>' +
            '</div>' +
            '<div class="profile-header-actions">' +
            '<button class="focusable btn-profile-logout" id="btn-logout">Log Out</button>' +
            '</div>' +
            '</div>' +

            '<div class="profile-settings-card">' +
            '<h3 class="profile-settings-title">Settings</h3>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide mature content</div>' +
            '<div class="setting-desc">You will not see adult (18+) content.</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideMature ? 'toggle-active' : '') + '" id="toggle-mature">' +
            (settings.hideMature ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide short content</div>' +
            '<div class="setting-desc">You will not see vertical videos less than 3 minutes.</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideShorts ? 'toggle-active' : '') + '" id="toggle-shorts">' +
            (settings.hideShorts ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +

            '<div class="setting-row">' +
            '<div class="setting-info">' +
            '<div class="setting-name">Hide synced YouTube videos</div>' +
            '<div class="setting-desc">You will not see videos that are synced from YouTube.</div>' +
            '</div>' +
            '<button class="focusable btn-setting-toggle ' + (settings.hideYoutube ? 'toggle-active' : '') + '" id="toggle-youtube">' +
            (settings.hideYoutube ? 'ON' : 'OFF') +
            '</button>' +
            '</div>' +
            '</div>' +
            '</div>';

        containerEl.innerHTML = html;
        SpatialNavigation.refresh();

        logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function () {
                Auth.logout(function () {
                    if (typeof onLogout === 'function') {
                        onLogout();
                    }
                });
            });
        }

        setupToggle('toggle-mature', 'hideMature');
        setupToggle('toggle-shorts', 'hideShorts');
        setupToggle('toggle-youtube', 'hideYoutube');

        setTimeout(function () {
            if (logoutBtn) {
                logoutBtn.focus();
                SpatialNavigation.refresh();
                SpatialNavigation.focusNode(logoutBtn);
            }
        }, 100);
    }

    return {
        renderLogin: renderLogin,
        renderProfile: renderProfile
    };
}());
