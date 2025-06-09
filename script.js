javascript: (function() {
    'use strict';
    const HCK_BOOKMARKLET_ID = 'hck-ui-bookmarklet-shortcuts';
    if (document.getElementById(HCK_BOOKMARKLET_ID)) { console.warn("HCK Shortcuts: Já em execução."); return; }
    
    const SCRIPT_VERSION = '15.1.0-cascade-client';
    const DEVELOPER = 'Cicatriz'; // Nome do desenvolvedor
    const INSTAGRAM_USERNAME = 'cicatriz'; // Substitua pelo seu nome de usuário real do Instagram
    
    const CONFIG = {
        MY_VERCEL_API_ENDPOINT: 'https://blackbox-alpha.vercel.app/api/chat',
        API_TIMEOUT: 30000,
        NOTIFICATION_TIMEOUT_SHORT: 3500,
        NOTIFICATION_TIMEOUT_LONG: 7000,
        IMAGE_FILTERS: {
            blocked: [/_logo\./i,/\.svg$/i,/icon/i,/button/i,/banner/i,/avatar/i,/profile/i,/thumb/i,/sprite/i,/captcha/i,/loading/i,/spinner/i,/placeholder/i,/background/i,/pattern/i,/texture/i,/favicon/i,/asset/i,/static/i,/decorator/i,/spacer/i,/dummy/i,/transparent/i,/white\.png/i,/black\.png/i,/grey\.png/i,/gray\.png/i,/1x1/i,/blank\.gif/i,/clear\.gif/i,/shim\.gif/i,/ad\./i,/advert/i,/tracking/i,/pixel/i,/beacon/i,/edusp-static\.ip\.tv\/(?:tms|sala-do-futuro)\//i,/s3\.sa-east-1\.amazonaws\.com\/edusp-static\.ip\.tv\/room\/cards\//i,/conteudo_logo\.png$/i,/logo_sala_do_futuro\.png$/i],
            verify(src) { if (!src || typeof src !== 'string' || (!src.startsWith('http') && !src.startsWith('data:image'))) return false; if (this.blocked.some(r => r.test(src))) { return false; } return true; }
        }
    };
    const STATE = { 
        logMessages: [], 
        lastAnswer: null, 
        isCycleRunning: false, 
        ui: {},
        instagramVerified: false // Estado para verificar se o usuário seguiu no Instagram
    };

    const logMessage = (level, ...args) => { const ts = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}); STATE.logMessages.push({ts,level,message:args.join(' ')}); const consoleFunc = console[level.toLowerCase()] || console.log; consoleFunc(`[HCK ${ts}]`, ...args); };
    const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rj) => setTimeout(() => rj(new Error(`Timeout ${ms}ms`)), ms))]);
    function sanitizeText(text) { if (typeof text !== 'string') return ''; return text.replace(/\n\s*\n/g, '\n').replace(/ {2,}/g, ' ').trim(); }

    function getCleanContentFromNode(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        if ((node.offsetParent === null && node.style.display !== 'flex') || node.style.display === 'none') return '';
        const tagName = node.tagName.toUpperCase();
        if (tagName === 'IMG') {
            try {
                const src = node.src || node.dataset.src;
                if (!src) return '';
                const absUrl = new URL(src, window.location.href).toString();
                if (CONFIG.IMAGE_FILTERS.verify(absUrl)) return ` [IMAGEM]: ${absUrl} `;
            } catch (e) {}
            return '';
        }
        if (node.matches('mjx-container, .MathJax, .katex, math')) {
            let latexSource = node.getAttribute('aria-label') || node.dataset.latex || node.querySelector('annotation[encoding*="tex"]')?.textContent || '';
            if (latexSource.trim()) return ` $${latexSource.trim()}$ `;
        }
        let innerContent = '';
        if (node.hasChildNodes()) {
            for (const child of node.childNodes) { innerContent += getCleanContentFromNode(child); }
        }
        if (['P', 'DIV', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'BR', 'TR'].includes(tagName)) { return innerContent + '\n'; }
        return innerContent;
    }

    function extractQuestionTextFromPage() {
        let questionCard = null;
        const selectors = 'div.MuiPaper-root, article[class*="question"], section[class*="assessment"], div[class*="questao"]';
        const allCards = document.querySelectorAll(selectors);
        for (const card of allCards) {
            if (card.closest('#' + HCK_BOOKMARKLET_ID)) continue;
            if (card.querySelector('div[role="radiogroup"], ul[class*="option"], ol[class*="choice"]')) {
                questionCard = card;
                break;
            }
        }
        if (!questionCard) { questionCard = document.body; }
        let enunciado = '';
        const enunciadoContainer = questionCard.querySelector('.ql-editor, div[class*="enunciado"], .question-statement, .texto-base');
        if (enunciadoContainer && !enunciadoContainer.closest('div[role="radiogroup"]')) {
            enunciado = getCleanContentFromNode(enunciadoContainer);
        } else {
            let tempEnunciado = '';
            for (const child of questionCard.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE && (child.matches('div[role="radiogroup"], ul[class*="option"], ol[class*="choice"]') || child.querySelector('div[role="radiogroup"]'))) break;
                tempEnunciado += getCleanContentFromNode(child);
            }
            enunciado = tempEnunciado;
        }
        enunciado = sanitizeText(enunciado);
        const alternativasTextos = [];
        const radioGroup = questionCard.querySelector('div[role="radiogroup"], ul[class*="option"], ol[class*="choice"]');
        if (radioGroup) {
            const alternativeItems = Array.from(radioGroup.children).filter(el => el.matches('div, label, li'));
            alternativeItems.forEach((item) => {
                if (alternativasTextos.length >= 5) return;
                const letter = String.fromCharCode(65 + alternativasTextos.length);
                let content = getCleanContentFromNode(item).trim();
                content = content.replace(/^[A-Ea-e][\)\.]\s*/, '').trim();
                if (content) { alternativasTextos.push(`${letter}) ${sanitizeText(content)}`); }
            });
        }
        if (enunciado.trim().length < 5 && alternativasTextos.every(a => a.length < 10)) { return "Falha ao extrair a questão. Conteúdo insuficiente."; }
        let formattedOutput = "--- Enunciado e Contexto ---\n" + (enunciado || "(Nenhum enunciado detectado)");
        if (alternativasTextos.length > 0) {
            formattedOutput += "\n\n--- Alternativas ---\n" + alternativasTextos.join('\n');
        } else {
            formattedOutput += "\n\n(Nenhuma alternativa detectada)";
        }
        return formattedOutput.replace(/\n{3,}/g, '\n\n').trim();
    }
    
    async function queryVercelApi(queryText) {
        try {
            const payload = { messages: [{ role: "user", content: queryText }] };
            const res = await fetch(CONFIG.MY_VERCEL_API_ENDPOINT, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(payload) 
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
            if (data.response) return data;
            throw new Error("Resposta da API inválida.");
        } catch (error) {
            console.error("Erro na API:", error);
            throw error;
        }
    }
    
    function formatResponse(answer) { 
        if(typeof answer !== 'string') return null; 
        const txt = answer.trim(); 
        if(/^[A-E]$/i.test(txt)) return txt.toUpperCase(); 
        const match = txt.match(/\b([A-E])\b/i); 
        return match ? match[1].toUpperCase() : null; 
    }

    const PULSE_CLASS = 'hck-radio-pulse-visual';
    function applyPulseToAlternative(letter) { 
        document.querySelectorAll('.' + PULSE_CLASS).forEach(el => el.classList.remove(PULSE_CLASS)); 
        if(!letter || !/^[A-E]$/i.test(letter)) return; 
        const index = letter.toUpperCase().charCodeAt(0) - 65; 
        const alts = document.querySelectorAll('div[role="radiogroup"] > label, div[role="radiogroup"] > div, ul[class*="option"] > li, ol[class*="choice"] > li'); 
        if(alts[index]){ 
            const target = alts[index].querySelector('.MuiRadio-root, input[type=radio]') || alts[index]; 
            target.classList.add(PULSE_CLASS); 
        } 
    }
    
    async function doFullCycle() {
        if (!STATE.instagramVerified) {
            showInstagramVerification();
            return;
        }
        
        if (STATE.isCycleRunning) return;
        STATE.isCycleRunning = true;
        STATE.lastAnswer = null;
        applyPulseToAlternative(null);
        STATE.ui.helpers.showResponse({ answer: "Processando Questão...", detail: `Consultando especialistas...`, type: 'info' });
        try {
            let questionText = extractQuestionTextFromPage();
            if (questionText.startsWith("Falha")) throw new Error(questionText);
            
            STATE.ui.elements.input.value = questionText;
            STATE.ui.elements.input.scrollTop = 0;
            
            const apiResult = await withTimeout(queryVercelApi(questionText), CONFIG.API_TIMEOUT);
            const formattedAnswer = formatResponse(apiResult.response);
            
            let sourceIcon = '💾';
            if (apiResult.source === 'live_ai') sourceIcon = '⚡️';
            
            let detailString = `Respondido por: ${apiResult.model || 'IA'}`;
            if (apiResult.source === 'database_cache') {
                const modelOrigin = apiResult.details?.modelOrigin || 'IA';
                detailString = `Do cache (por ${modelOrigin})`;
            }

            if (formattedAnswer) {
                STATE.lastAnswer = formattedAnswer;
                STATE.ui.helpers.showResponse({ answer: `${sourceIcon} Resposta: ${formattedAnswer}`, detail: detailString, type: 'success' });
            } else {
                throw new Error("IA não retornou A-E.");
            }
        } catch (error) {
            logMessage('ERROR', "Falha no ciclo:", error);
            STATE.ui.helpers.showResponse({ answer: "Erro no Ciclo", detail: error.message.substring(0, 50), type: 'error' });
        } finally {
            STATE.isCycleRunning = false;
        }
    }

    function showLastAnswer() { 
        if (!STATE.instagramVerified) {
            showInstagramVerification();
            return;
        }
        
        if(STATE.isCycleRunning){ 
            STATE.ui.helpers.showResponse({answer:"Aguarde", detail:"Processamento em curso...", type:'warn'}); 
            return; 
        } 
        if(STATE.lastAnswer){ 
            applyPulseToAlternative(STATE.lastAnswer); 
            STATE.ui.helpers.showResponse({answer:`Marcando: ${STATE.lastAnswer}`, detail: "Alternativa destacada.", type:'success'}); 
            STATE.lastAnswer = null; 
        } else { 
            STATE.ui.helpers.showResponse({answer:"Nada a mostrar", detail:"Execute o ciclo (2) primeiro.", type:'warn'}); 
        } 
    }
    
    function killSwitch() { 
        document.removeEventListener('keydown', handleShortcuts, true); 
        document.getElementById(HCK_BOOKMARKLET_ID)?.remove(); 
        document.getElementById('hck-pulse-styles')?.remove(); 
        document.getElementById('hck-notifications-container')?.remove(); 
        document.getElementById('hck-instagram-verification')?.remove(); 
    }
    
    function handleShortcuts(event) { 
        if(event.target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) return; 
        if(event.repeat) return; 
        switch(event.key){ 
            case '1': 
                event.preventDefault(); 
                STATE.ui.helpers.toggleMenu(); 
                break; 
            case '2': 
                event.preventDefault(); 
                doFullCycle(); 
                break; 
            case '3': 
                event.preventDefault(); 
                showLastAnswer(); 
                break; 
            case '5': 
                event.preventDefault(); 
                killSwitch(); 
                break; 
        } 
    }

    // Função para mostrar a tela de verificação do Instagram
    function showInstagramVerification() {
        // Remover qualquer verificação anterior
        const existingVerification = document.getElementById('hck-instagram-verification');
        if (existingVerification) existingVerification.remove();
        
        const C = { font: "'Fira Code', 'Source Code Pro', monospace", bg: '#1A1A1A', bg2: '#252525', text: '#E0E0E0', text2: '#888888', accent: '#00FF41', success: '#00FF41', error: '#FF4181', warn: '#FFDB41', pulse: '#F50057', border: '#333333', notifBg: 'rgba(26, 26, 26, 0.95)', glow: '0 0 8px #00FF4144' };
        
        const verificationContainer = document.createElement('div');
        verificationContainer.id = 'hck-instagram-verification';
        verificationContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 2147483647;
            font-family: ${C.font};
        `;
        
        const verificationBox = document.createElement('div');
        verificationBox.style.cssText = `
            background: ${C.bg};
            width: 400px;
            padding: 20px;
            border-radius: 8px;
            box-shadow: ${C.glow};
            display: flex;
            flex-direction: column;
            gap: 15px;
            border: 1px solid ${C.border};
        `;
        
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 10px;
            border-bottom: 1px solid ${C.border};
        `;
        
        const title = document.createElement('div');
        title.innerHTML = `HCK.sh <span style="animation:blink 1s step-end infinite; color:${C.accent};">_</span>`;
        title.style.cssText = `font-weight:600; font-size:18px; color:${C.accent}; text-shadow: ${C.glow};`;
        
        const closeBtn = document.createElement('div');
        closeBtn.textContent = '[X]';
        closeBtn.style.cssText = `color:${C.text2}; font-size:16px; cursor:pointer;`;
        closeBtn.onclick = killSwitch;
        
        titleBar.append(title, closeBtn);
        
        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = `color:${C.text}; font-size:14px; line-height:1.5;`;
        contentDiv.innerHTML = `
            <p>Para utilizar este hack, você precisa seguir o desenvolvedor no Instagram:</p>
            <p style="text-align:center; font-size:18px; margin:15px 0; color:${C.accent};">@${INSTAGRAM_USERNAME}</p>
            <p>Após seguir, clique no botão abaixo para confirmar e continuar.</p>
        `;
        
        const creditsDiv = document.createElement('div');
        creditsDiv.style.cssText = `color:${C.text2}; font-size:12px; text-align:center; margin-top:10px;`;
        creditsDiv.innerHTML = `Desenvolvido por: <span style="color:${C.accent};">${DEVELOPER}</span>`;
        
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `display:flex; justify-content:center; gap:10px; margin-top:10px;`;
        
        const confirmButton = document.createElement('button');
        confirmButton.textContent = 'Já segui, continuar';
        confirmButton.style.cssText = `
            background: ${C.accent};
            color: #000;
            border: none;
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-family: inherit;
            transition: all 0.2s;
        `;
        confirmButton.onmouseover = () => { confirmButton.style.opacity = '0.9'; };
        confirmButton.onmouseout = () => { confirmButton.style.opacity = '1'; };
        confirmButton.onclick = () => {
            STATE.instagramVerified = true;
            verificationContainer.remove();
            STATE.ui.helpers.showResponse({answer:"Verificação concluída", detail:`Obrigado por seguir @${INSTAGRAM_USERNAME}`, type:'success'});
        };
        
        const instagramButton = document.createElement('button');
        instagramButton.textContent = 'Abrir Instagram';
        instagramButton.style.cssText = `
            background: #E1306C;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-family: inherit;
            transition: all 0.2s;
        `;
        instagramButton.onmouseover = () => { instagramButton.style.opacity = '0.9'; };
        instagramButton.onmouseout = () => { instagramButton.style.opacity = '1'; };
        instagramButton.onclick = () => {
            window.open(`https://www.instagram.com/${INSTAGRAM_USERNAME}/`, '_blank');
        };
        
        buttonContainer.append(instagramButton, confirmButton);
        verificationBox.append(titleBar, contentDiv, buttonContainer, creditsDiv);
        verificationContainer.appendChild(verificationBox);
        document.body.appendChild(verificationContainer);
    }

    function setupUI() {
        const C = { font: "'Fira Code', 'Source Code Pro', monospace", bg: '#1A1A1A', bg2: '#252525', text: '#E0E0E0', text2: '#888888', accent: '#00FF41', success: '#00FF41', error: '#FF4181', warn: '#FFDB41', pulse: '#F50057', border: '#333333', notifBg: 'rgba(26, 26, 26, 0.8)', glow: '0 0 8px #00FF4144' };
        const blinkAnimation = `@keyframes blink { 50% { opacity: 0; } }`;
        const pulseAnimation = `@keyframes hck-pulse-strong-visual{0%{box-shadow:0 0 0 0 ${C.pulse}b3}70%{box-shadow:0 0 0 16px ${C.pulse}00}100%{box-shadow:0 0 0 0 ${C.pulse}00}}`;
        
        // Adicionar estilos
        const styleSheet = document.createElement("style"); 
        styleSheet.id = 'hck-pulse-styles'; 
        styleSheet.innerText = `${blinkAnimation} ${pulseAnimation} .${PULSE_CLASS}{border-radius:50%!important; animation:hck-pulse-strong-visual 1.5s infinite cubic-bezier(.66,0,0,1); z-index:9999;}`; 
        document.head.appendChild(styleSheet);
        
        // Criar container principal
        const mainContainer = document.createElement('div'); 
        mainContainer.id = HCK_BOOKMARKLET_ID; 
        mainContainer.style.cssText = `position:fixed; bottom:12px; right:12px; z-index:2147483646; font-family:${C.font};`;
        
        // Criar painel do menu
        const menuPanel = document.createElement('div'); 
        menuPanel.style.cssText = `background:${C.bg}; width:260px; padding:10px; border-radius:8px; box-shadow:${C.glow}; display:none; flex-direction:column; gap:8px; border:1px solid ${C.border}; transition: opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1), transform 0.3s cubic-bezier(0.25, 1, 0.5, 1); opacity:0; transform: translateY(10px) scale(0.95); pointer-events: none;`;
        
        // Criar barra de título
        const titleBar = document.createElement('div'); 
        titleBar.style.cssText = `display:flex; justify-content:space-between; align-items:center; padding-bottom:6px; margin-bottom: 4px; border-bottom:1px solid ${C.border};`;
        
        const title = document.createElement('div'); 
        title.innerHTML = `HCK.sh <span style="animation:blink 1s step-end infinite; color:${C.accent};">_</span>`;
        title.style.cssText = `font-weight:600; font-size:16px; color:${C.accent}; text-shadow: ${C.glow};`;
        
        const closeBtn = document.createElement('div'); 
        closeBtn.textContent = '[X]'; 
        closeBtn.style.cssText = `color:${C.text2}; font-size:14px; cursor:pointer;`;
        
        titleBar.append(title, closeBtn);
        
        // Criar área de entrada
        const inputArea = document.createElement('textarea'); 
        inputArea.placeholder = 'Extracted content will appear here...'; 
        inputArea.rows = 6; 
        inputArea.readOnly = true; 
        inputArea.style.cssText = `width:100%; box-sizing:border-box; resize:vertical; background:${C.bg2}; color:${C.text2}; border:1px solid ${C.border}; border-radius:4px; padding:8px; font-size:11px; font-family:inherit;`;
        
        // Criar ajuda de atalhos
        const shortcutsHelp = document.createElement('div'); 
        shortcutsHelp.innerHTML = `<div style="display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:12px; color:${C.text2};"><b style="color:${C.accent};">1:</b><span>Toggle Menu</span><b style="color:${C.accent};">2:</b><span>Execute</span><b style="color:${C.accent};">3:</b><span>Show Answer</span><b style="color:${C.accent};">5:</b><span>Kill Process</span></div>`;
        
        // Adicionar créditos ao desenvolvedor
        const creditsDiv = document.createElement('div');
        creditsDiv.style.cssText = `color:${C.text2}; font-size:11px; text-align:center; margin-top:5px; border-top:1px solid ${C.border}; padding-top:5px;`;
        creditsDiv.innerHTML = `Desenvolvido por: <span style="color:${C.accent};">${DEVELOPER}</span>`;
        
        // Montar o painel do menu
        menuPanel.append(titleBar, inputArea, shortcutsHelp, creditsDiv); 
        mainContainer.appendChild(menuPanel); 
        document.body.appendChild(mainContainer);
        
        // Criar container de notificações
        const notificationContainer = document.createElement('div'); 
        notificationContainer.id = 'hck-notifications-container'; 
        notificationContainer.style.cssText = `position:fixed; top:20px; right:20px; z-index:2147483647; display:flex; flex-direction:column; align-items:flex-end; gap:10px;`; 
        document.body.appendChild(notificationContainer);
        
        // Função para alternar o menu
        const toggleMenu = (forceShow) => { 
            const isHidden = menuPanel.style.opacity === '0'; 
            const show = forceShow === undefined ? isHidden : forceShow; 
            if (show) { 
                menuPanel.style.display = 'flex'; 
                requestAnimationFrame(() => { 
                    menuPanel.style.opacity = '1'; 
                    menuPanel.style.transform = 'translateY(0) scale(1)'; 
                    menuPanel.style.pointerEvents = 'auto'; 
                }); 
            } else { 
                menuPanel.style.opacity = '0'; 
                menuPanel.style.transform = 'translateY(10px) scale(0.95)'; 
                menuPanel.style.pointerEvents = 'none'; 
                setTimeout(() => { 
                    if(menuPanel.style.opacity === '0') menuPanel.style.display = 'none'; 
                }, 300); 
            } 
        };
        
        // Configurar o botão de fechar
        closeBtn.onclick = () => toggleMenu(false);
        
        // Função para mostrar resposta
        const showResponse = (res, duration) => { 
            const { answer="Info", detail="", type='info' } = res || {}; 
            let color = C.accent; 
            if (type==='success'){ color=C.success; } 
            else if (type==='error'){ color=C.error; } 
            else if (type==='warn'){ color=C.warn; } 
            
            const notif = document.createElement('div'); 
            notif.style.cssText = `background-color:${C.notifBg}; backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); color:${C.text}; padding: 8px 12px; border-radius:6px; box-shadow:${C.glow}; display:flex; align-items:center; gap:10px; max-width:300px; opacity:0; transform:translateX(20px) scale(0.95); transition:all .3s cubic-bezier(0.25, 1, 0.5, 1); border:1px solid ${C.border}; border-left: 3px solid ${color}; cursor:pointer; font-size: 13px;`; 
            notif.innerHTML = `<div><strong style="color:${color};">${answer}</strong> ${detail ? `<span style="font-size:0.9em; color:${C.text2}; display:block;">${detail.replace(/</g, "<")}</span>` : ''}</div>`; 
            
            let hideTimeout; 
            const hideNotif = () => { 
                clearTimeout(hideTimeout); 
                notif.style.opacity='0'; 
                notif.style.transform='translateX(20px) scale(0.95)'; 
                setTimeout(() => notif.remove(), 300); 
            }; 
            
            notif.onclick = hideNotif; 
            notificationContainer.appendChild(notif); 
            
            requestAnimationFrame(() => { 
                notif.style.opacity='1'; 
                notif.style.transform='translateX(0) scale(1)'; 
            }); 
            
            const timeoutDuration = duration || (type === 'error' || type === 'warn' ? CONFIG.NOTIFICATION_TIMEOUT_LONG : CONFIG.NOTIFICATION_TIMEOUT_SHORT); 
            hideTimeout = setTimeout(hideNotif, timeoutDuration); 
        };
        
        return { 
            elements: { input: inputArea }, 
            helpers: { toggleMenu, showResponse } 
        };
    }

    function init() {
        logMessage('INFO',`----- HCK Shortcuts (v${SCRIPT_VERSION}) Activated -----`);
        try {
            STATE.ui = setupUI();
            if(!STATE.ui) throw new Error("UI Initialization Failed.");
            document.addEventListener('keydown', handleShortcuts, true);
            
            // Mostrar verificação do Instagram ao iniciar
            showInstagramVerification();
            
        } catch(error) {
            logMessage('ERROR','!!! CRITICAL INIT FAILURE !!!', error);
            killSwitch();
        }
    }
    init();
})();
