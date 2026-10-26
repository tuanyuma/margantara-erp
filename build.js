const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SOURCE_TEMPLATE = path.join(ROOT_DIR, 'Index.html');
const OUTPUT_FILE = path.join(DIST_DIR, 'index.html');

// Pastikan direktori dist/ tersedia
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

console.log('🚀 Memulai kompilasi Frontend Margantara ERP untuk Vercel...');

let content = fs.readFileSync(SOURCE_TEMPLATE, 'utf8');

// Regex untuk mencocokkan format include GAS: <?!= include('FileName'); ?> atau <?!= include("FileName"); ?>
const includeRegex = /<\?!=\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;

let matchCount = 0;
content = content.replace(includeRegex, (match, fileName) => {
  const partialPath = path.join(ROOT_DIR, fileName + '.html');
  if (fs.existsSync(partialPath)) {
    matchCount++;
    console.log(`  ✓ Menggabungkan partial: ${fileName}.html`);
    return fs.readFileSync(partialPath, 'utf8');
  } else {
    console.warn(`  ⚠️ Peringatan: Partial ${fileName}.html tidak ditemukan di ${partialPath}`);
    return match;
  }
});

// Universal REST API Bridge untuk Vercel & Static Hosting
const bridgeScript = `
    <!-- ========================================================================= -->
    <!-- UNIVERSAL REST API BRIDGE FOR VERCEL & EXTERNAL HOSTING                   -->
    <!-- Auto-routes google.script.run to Google Apps Script doPost REST API       -->
    <!-- ========================================================================= -->
    <script>
    (function() {
        window.GAS_API_URL = "https://script.google.com/macros/s/AKfycbwIKhoax01Fg-lM6___D5lmmmyrhu_eyIYAFhpPsE9vgIJ00Vp7Eyyero-xO_lkVW7K/exec";

        if (typeof google === 'undefined' || !google.script || !google.script.run) {
            console.log('⚡ [Vercel Hosting] Mengaktifkan Universal REST API Bridge ke:', window.GAS_API_URL);

            function createRunner() {
                var runner = {
                    _successHandler: null,
                    _failureHandler: null,
                    withSuccessHandler: function(fn) {
                        this._successHandler = fn;
                        return this;
                    },
                    withFailureHandler: function(fn) {
                        this._failureHandler = fn;
                        return this;
                    },
                    apiCall: function(action, payload) {
                        var success = this._successHandler;
                        var failure = this._failureHandler;
                        var targetUrl = window.GAS_API_URL;

                        fetch(targetUrl, {
                            method: 'POST',
                            mode: 'cors',
                            headers: {
                                'Content-Type': 'text/plain;charset=utf-8'
                            },
                            body: JSON.stringify({
                                action: action,
                                payload: payload || {}
                            })
                        })
                        .then(function(response) {
                            if (!response.ok) {
                                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                            }
                            return response.json();
                        })
                        .then(function(data) {
                            if (typeof success === 'function') {
                                success(data);
                            }
                        })
                        .catch(function(err) {
                            console.error('[Bridge API Error] ' + action + ':', err);
                            if (typeof failure === 'function') {
                                failure(err);
                            }
                        });
                    }
                };
                return runner;
            }

            window.google = {
                script: {
                    get run() {
                        return createRunner();
                    }
                }
            };
        }
    })();
    </script>
`;

// Sisipkan bridgeScript tepat di dalam <head>
if (content.includes('</head>')) {
  content = content.replace('</head>', bridgeScript + '\n</head>');
} else {
  content = bridgeScript + '\n' + content;
}

fs.writeFileSync(OUTPUT_FILE, content, 'utf8');

console.log(`\n🎉 Selesai! Sebanyak ${matchCount} file partial berhasil dikompilasi ke:\n   ${OUTPUT_FILE}`);
