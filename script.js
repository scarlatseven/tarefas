javascript: (function() {
    'use strict';
    const HCK_ID = 'hck-prova-paulista-v2';
    if (document.getElementById(HCK_ID)) { console.warn("HCK: JÃ¡ em execuÃ§Ã£o."); return; }

    const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile()) {
        alert("HCK - PROVA PAULISTA V2\n\nEste script nÃ£o tem suporte para dispositivos mÃ³veis.");
        return;
    }
    
    const SCRIPT_VERSION = '12.1.0-notif-fix';
    const CONFIG = {
        API_ENDPOINT: 'https://blackbox-alpha.vercel.app/api/chat',
        MODELS: [
            { id: "gemini-1.5-flash", name: "Gemini 1.5 (Geral/VisÃ£o)" },
            { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 (Humanas)" },
            { id: "deepseek-reasoner", name: "DeepSeek-R1 (Exatas)" },
            { id: "deepseek-chat", name: "DeepSeek-V3 (RÃ¡pido)" }
        ],
        API_TIMEOUT: 30000,
        NOTIFICATION_TIMEOUT: 4000
    };
    const STATE = { lastAnswer: null, isRunning: false, currentModelIndex: 0, ui: {}, activeNotifications: {} };

    const log = (level, ...args) => (console[level.toLowerCase()] || console.log)(`[HCK]`, ...args);
    const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rj) => setTimeout(() => rj(new Error(`Timeout ${ms}ms`)), ms))]);
    const sanitize = (text) => typeof text === 'string' ? text.replace(/\n\s*\n/g, '\n').replace(/ {2,}/g, ' ').trim() : '';
    
    function getContent(node) {
        if (!node || (node.nodeType === Node.ELEMENT_NODE && ((node.offsetParent === null && node.style.display !== 'flex') || node.style.display === 'none'))) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
        const tagName = node.tagName?.toUpperCase();
        if (tagName === 'IMG') {
            try {
                const url = new URL(node.src || node.dataset.src, window.location.href).toString();
                if (!/(_logo|\.svg|icon|button|banner|avatar|profile|thumb|sprite|captcha|loading|spinner|placeholder|background|pattern|texture|favicon|asset|static|decorator|spacer|dummy|transparent|1x1|blank\.gif|clear\.gif|ad\.|advert|tracking|pixel|beacon)/i.test(url)) return ` [IMAGEM]: ${url} `;
            } catch (e) {}
            return '';
        }
        if (node.matches && node.matches('mjx-container, .MathJax, .katex, math')) {
            const latex = node.getAttribute('aria-label') || node.dataset.latex || node.querySelector('annotation[encoding*="tex"]')?.textContent;
            if (latex?.trim()) return ` $${latex.trim()}$ `;
        }
        let inner = '';
        if (node.hasChildNodes()) { for (const child of node.childNodes) { inner += getContent(child); } }
        if (['P', 'DIV', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'BR', 'TR'].includes(tagName)) return inner + '\n';
        return inner;
    }

    function extractQuestion() {
        let card = null;
        const selectors = 'div.MuiPaper-root, article[class*="question"], section[class*="assessment"], div[class*="questao"]';
        for (const c of document.querySelectorAll(selectors)) { if (c.closest('#'+HCK_ID)) continue; if (c.querySelector('div[role="radiogroup"], ul[class*="option"], ol[class*="choice"]')) { card = c; break; } }
        if (!card) card = document.body;
        let statement = '';
        const statementEl = card.querySelector('.ql-editor, div[class*="enunciado"], .question-statement, .texto-base');
        if (statementEl && !statementEl.closest('div[role="radiogroup"]')) { statement = getContent(statementEl);
        } else { for (const child of card.childNodes) { if (child.nodeType === Node.ELEMENT_NODE && (child.matches('div[role="radiogroup"], ul[class*="option"], ol[class*="choice"]') || child.querySelector('div[role="radiogroup"]'))) break; statement += getContent(child); } }
        statement = sanitize(statement);
        const alternatives = [];
        const radioGroup = card.querySelector('div[role="radiogroup"], ul[class*="option"], ol[class*="choice"]');
        if (radioGroup) {
            const items = Array.from(radioGroup.children).filter(el => el.matches('div, label, li'));
            items.forEach((item) => {
                if (alternatives.length >= 5) return;
                const letter = String.fromCharCode(65 + alternatives.length);
                let content = sanitize(getContent(item)).replace(/^[A-Ea-e][\)\.]\s*/, '').trim();
                if (content) alternatives.push(`${letter}) ${content}`);
            });
        }
        if (statement.length < 5 && alternatives.every(a => a.length < 10)) return "Falha na extraÃ§Ã£o: conteÃºdo insuficiente.";
        return `--- Enunciado ---\n${statement || "(Vazio)"}\n\n--- Alternativas ---\n${alternatives.join('\n') || "(Nenhuma)"}`.replace(/\n{3,}/g, '\n\n');
    }

    async function queryApi(text, modelId) {
        const payload = { messages: [{ role: "user", content: text }], modelId: modelId };
        const res = await fetch(CONFIG.API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || `Erro HTTP ${res.status}`);
        if (data.response) return data;
        throw new Error("API retornou resposta invÃ¡lida.");
    }

    const formatResponse = (ans) => typeof ans === 'string' ? (ans.trim().match(/\b([A-E])\b/i)?.[1] || ans.trim().match(/^[A-E]$/i)?.[0])?.toUpperCase() : null;
    const PULSE_CLASS = 'hck-pulse-visual';
    function applyPulse(letter) {
        document.querySelectorAll('.'+PULSE_CLASS).forEach(e => e.classList.remove(PULSE_CLASS));
        if (!letter) return;
        const index = letter.charCodeAt(0) - 65;
        const alts = document.querySelectorAll('div[role="radiogroup"] > label, div[role="radiogroup"] > div, ul[class*="option"] > li, ol[class*="choice"] > li');
        if (alts[index]) (alts[index].querySelector('.MuiRadio-root, input[type=radio]') || alts[index]).classList.add(PULSE_CLASS);
    }

    function cycleModel() {
        if (STATE.isRunning) return;
        STATE.currentModelIndex = (STATE.currentModelIndex + 1) % CONFIG.MODELS.length;
        const newModel = CONFIG.MODELS[STATE.currentModelIndex];
        STATE.ui.updateModelDisplay(newModel.name);
        STATE.ui.notify({ id: 'model_change', text: "Modelo Alterado", detail: newModel.name, type: 'info' });
    }

    async function run() {
        if (STATE.isRunning) return;
        STATE.isRunning = true;
        STATE.lastAnswer = null;
        applyPulse(null);
        const currentModel = CONFIG.MODELS[STATE.currentModelIndex];
        STATE.ui.notify({ id: 'processing_status', text: "Processando...", detail: `Usando: ${currentModel.name}`, type: 'processing' });
        try {
            const question = extractQuestion();
            if (question.startsWith("Falha")) throw new Error(question);
            const result = await withTimeout(queryApi(question, currentModel.id), CONFIG.API_TIMEOUT);
            const answer = formatResponse(result.response);
            const icon = result.source === 'database_cache' ? 'ðŸ’¾' : 'âš¡ï¸';
            const modelName = result.model ? result.model.split('/').pop().replace(/-latest$/, '') : 'IA';
            const detail = result.source === 'database_cache' ? `Do cache (por ${result.details?.modelOrigin?.split('/').pop() || modelName})` : `Respondido por ${modelName}`;
            if (answer) {
                STATE.lastAnswer = answer;
                STATE.ui.notify({ id: 'processing_status', text: `${icon} Resposta: ${answer}`, detail: detail, type: 'success' });
            } else {
                throw new Error("Formato de resposta invÃ¡lido.");
            }
        } catch (error) {
            log('ERROR', "Falha no ciclo:", error);
            STATE.ui.notify({ id: 'processing_status', text: "Ocorreu um Erro", detail: error.message.substring(0, 40), type: 'error' });
        } finally {
            STATE.isRunning = false;
        }
    }

    function showAnswer() { if (STATE.isRunning) return; if (STATE.lastAnswer) { applyPulse(STATE.lastAnswer); STATE.ui.notify({ id: 'marking_status', text: `Mostrando Resposta: ${STATE.lastAnswer}`, type: 'marking' }); STATE.lastAnswer = null; } else { STATE.ui.notify({ id: 'marking_status', text: "Nenhuma resposta para mostrar", detail: "Use [2] para executar.", type: 'warn' }); } }
    function kill() { document.removeEventListener('keydown', handleKeys, true); document.getElementById(HCK_ID)?.remove(); }
    function handleKeys(e) { if (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.repeat) return; const actions = {'1':STATE.ui.toggleMenu, '2':run, '3':showAnswer, '4':cycleModel, '5':kill}; actions[e.key]?.(e.preventDefault()); if (e.key === 'Escape') STATE.ui.toggleMenu(false); }

    function setupUI() {
        const C = { font: "'JetBrains Mono', monospace", bg: 'rgba(16, 16, 24, 0.9)', text: '#E2E2FF', text2: '#8890B3', grad: 'linear-gradient(90deg, #C77DFF, #00D0FF)', pulse: '#F50057', border: '#333344', shadow: '0 8px 30px rgba(0,0,0,0.5)' };
        const style = document.createElement("style");
        style.textContent = `@keyframes hck-pulse-anim{to{box-shadow:0 0 0 12px transparent;}} .${PULSE_CLASS}{border-radius:50%; animation: hck-pulse-anim 1.2s infinite; box-shadow: 0 0 0 0 ${C.pulse};} @keyframes hck-fade-in{from{opacity:0;transform:scale(0.95) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}} @keyframes hck-progress-bar{from{width:100%;}to{width:0%;}}`;
        document.head.appendChild(style);
        
        const container = document.createElement('div'); container.id = HCK_ID;
        container.style.cssText = `position:fixed; bottom:20px; right:20px; z-index:2147483647; font-family:${C.font}; animation:hck-fade-in .4s ease-out;`;

        const menu = document.createElement('div');
        menu.style.cssText = `width:280px; background:${C.bg}; backdrop-filter:blur(10px); color:${C.text}; padding:10px; border-radius:10px; border:1px solid ${C.border}; box-shadow:${C.shadow}; display:none; flex-direction:column; gap:8px; transition: all .3s ease-out; position:absolute; bottom:calc(100% + 10px); right:0; opacity:0; transform-origin: bottom right;`;
        
        const titleBar = document.createElement('div');
        titleBar.innerHTML = `<div style="font-weight:600; font-size:14px; background:${C.grad}; -webkit-background-clip:text; -webkit-text-fill-color:transparent;">HCK - PROVA PAULISTA V2</div><div style="font-size:9px; color:${C.text2}; align-self:flex-end;">v${SCRIPT_VERSION}</div>`;
        titleBar.style.cssText = `display:flex; justify-content:space-between; align-items:center;`;
        
        const modelDisplay = document.createElement('div');
        modelDisplay.style.cssText = `font-size:11px; color:${C.text2}; text-align:center; background:rgba(0,0,0,0.2); padding: 5px; border-radius: 6px; border: 1px solid ${C.border}; margin-top: 8px;`;
        
        const shortcuts = document.createElement('div');
        shortcuts.innerHTML = `<div style="display:grid; grid-template-columns:auto 1fr; gap:5px 12px; font-size:11px; color:${C.text2}; margin-top:8px; padding-top:8px; border-top: 1px solid ${C.border};"><b style="color:${C.text};">[1]</b>Menu <b style="color:${C.text};">[2]</b>Executar <b style="color:${C.text};">[3]</b>Marcar <b style="color:${C.text};">[4]</b>Mudar Modelo <b style="color:${C.text};">[5]</b>Sair</div>`;
        
        const credits = document.createElement('div');
        credits.innerHTML = `by <b style="background:${C.grad};-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Hackermoon1</b> & <b style="background:${C.grad};-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Dontbrazz</b>`;
        credits.style.cssText = `font-size:10px; color:${C.text2}; opacity:0.7; text-align:center; padding-top:8px; margin-top:5px; border-top: 1px solid ${C.border};`;
        
        menu.append(titleBar, modelDisplay, shortcuts, credits);
        
        const toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        toggleBtn.style.cssText = `background:${C.bg}; color:${C.text2}; width:42px; height:42px; border:1px solid ${C.border}; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 10px rgba(0,0,0,0.3); transition: all .3s ease; opacity: 0.8;`;
        toggleBtn.onmouseover = () => { toggleBtn.style.opacity = '1'; toggleBtn.style.transform = 'scale(1.1)'; };
        toggleBtn.onmouseout = () => { toggleBtn.style.opacity = '0.8'; toggleBtn.style.transform = 'scale(1)'; };
        
        container.append(menu, toggleBtn);
        document.body.appendChild(container);

        const notificationContainer = document.createElement('div');
        notificationContainer.style.cssText = `position:fixed; top:20px; right:20px; z-index:2147483647; display:flex; flex-direction:column; align-items:flex-end; gap:10px;`;
        document.body.appendChild(notificationContainer);

        const updateModelDisplay = (modelName) => { modelDisplay.innerHTML = `Modelo: <strong style="color:${C.text};">${modelName}</strong>`; };

        const toggleMenu = (force) => {
            const shouldShow = force !== undefined ? force : menu.style.display === 'none';
            if(shouldShow) {
                menu.style.display = 'flex';
                setTimeout(() => { menu.style.opacity = '1'; menu.style.transform = 'scale(1) translateY(0)'; }, 10);
            } else {
                menu.style.opacity = '0';
                menu.style.transform = 'scale(0.95) translateY(10px)';
                setTimeout(() => { menu.style.display = 'none'; }, 300);
            }
        };
        toggleBtn.onclick = () => toggleMenu();

        const notify = (p) => {
            const {id, text, detail, type, duration} = {id: `notif_${Date.now()}`, text:'Info', detail:'', type:'info', ...p};
            if (STATE.activeNotifications[id]) STATE.activeNotifications[id]();
            
            let color = {'info':'#00D0FF', 'success':'#A070FF', 'error':'#F50057', 'warn':'#FFDB41', 'processing':'#FFDB41', 'marking': C.pulse}[type];
            const n = document.createElement('div');
            n.style.cssText=`width:280px; background:rgba(22, 22, 30, 0.9); backdrop-filter:blur(10px); color:${C.text}; padding:12px 16px; border-radius:10px; box-shadow:${C.shadow}; display:flex; flex-direction:column; gap:4px; opacity:0; transform:translateX(20px); transition:all .4s cubic-bezier(0.2, 1, 0.4, 1); border-left:4px solid ${color}; cursor:pointer; font-size:14px; overflow:hidden;`;
            n.innerHTML = `<strong style="color:${color};">${text}</strong>${detail ? `<span style="font-size:0.9em;color:${C.text2};display:block;">${detail}</span>` : ''}<div class="hck-progress-bar" style="position:absolute; bottom:0; left:0; height:2px; background:${color}; opacity:0.6;"></div>`;
            
            const hide = () => {
                n.style.opacity='0';
                n.style.transform='translateX(20px)';
                setTimeout(()=>n.remove(), 400);
                delete STATE.activeNotifications[id];
            };
            
            n.onclick = hide;
            notificationContainer.appendChild(n);
            setTimeout(() => { n.style.opacity='1'; n.style.transform='translateX(0)'; }, 10);

            const timeoutDuration = duration || (type === 'processing' ? CONFIG.API_TIMEOUT + 1000 : CONFIG.NOTIFICATION_TIMEOUT);
            const timeoutId = setTimeout(hide, timeoutDuration);

            STATE.activeNotifications[id] = () => {
                clearTimeout(timeoutId);
                hide();
            };
            
            if (type !== 'processing') {
                n.querySelector('.hck-progress-bar').style.animation = `hck-progress-bar ${timeoutDuration}ms linear forwards`;
            }
        };
        
        return { notify, updateModelDisplay, toggleMenu };
    }
    
    try {
        STATE.ui = setupUI();
        document.addEventListener('keydown', handleKeys, true);
        log('INFO', `----- HCK - PROVA PAULISTA V2 (v${SCRIPT_VERSION}) Activated -----`);
        STATE.ui.updateModelDisplay(CONFIG.MODELS[STATE.currentModelIndex].name);
        STATE.ui.notify({text:"HCK Ativado", detail:"Pressione [1] para ver o menu", type:'success'});
    } catch (e) { console.error('HCK Init Fail:', e); }
})();