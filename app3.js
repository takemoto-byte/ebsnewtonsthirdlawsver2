// DOMの読み込みが完了したらスクリプトを実行
document.addEventListener('DOMContentLoaded', () => {

    // --- キャンバスとコンテキストの取得 ---
    const canvas = document.getElementById('simulationCanvas');
    if (!canvas.getContext) return;
    const ctx = canvas.getContext('2d');

    //  指の画像をロード
    const fingerImage = new Image();
    fingerImage.src = 'finger.png'; // 指の画像ファイルのパス
    let isFingerImageLoaded = false;

    fingerImage.onload = () => {
        isFingerImageLoaded = true;
        drawSimulation(); // 画像読み込み完了後に再描画
    };
    fingerImage.onerror = () => {
        console.error("指の画像をロードできませんでした。'finger.png' が存在し、パスが正しいか確認してください。");
    };

    // --- 設定 ---
    const SCREEN_WIDTH = canvas.width;
    const SCREEN_HEIGHT = canvas.height;
    const GRAVITY_ACCELERATION = 10;
    const FLOOR_HEIGHT = 200;
    const FLOOR_COLOR = 'rgb(230, 230, 230)'; 
    const floorRect = { x: 0, y: SCREEN_HEIGHT - FLOOR_HEIGHT, width: SCREEN_WIDTH, height: FLOOR_HEIGHT };
    const VECTOR_WIDTH = 2;
    const VECTOR_COLORS = ['#000000']; 
    const FORCE_SCALE_FACTOR = 0.1;

    // --- ボタン設定 (3つ並べる) ---
    const buttonWidth = 100, buttonHeight = 40;
    const buttonGap = 50; // ボタン間の隙間
    
    // 3つのボタン全体の幅
    const totalButtonWidth = (buttonWidth * 3) + (buttonGap * 2);
    // 左端の開始位置
    const startButtonBaseX = (SCREEN_WIDTH - totalButtonWidth) / 2;
    const buttonY = SCREEN_HEIGHT - buttonHeight - 20;

    // 各ボタンの矩形定義
    const startButtonRect = { x: startButtonBaseX, y: buttonY, width: buttonWidth, height: buttonHeight };
    const undoButtonRect  = { x: startButtonBaseX + buttonWidth + buttonGap, y: buttonY, width: buttonWidth, height: buttonHeight };
    const resetButtonRect = { x: startButtonBaseX + (buttonWidth + buttonGap) * 2, y: buttonY, width: buttonWidth, height: buttonHeight };
    
    const START_BUTTON_COLOR_IDLE = '#90EE90'; 
    const UNDO_BUTTON_COLOR_IDLE  = '#FFD700'; // 黄色
    const RESET_BUTTON_COLOR_IDLE = '#ADD8E6'; 
    const BUTTON_FONT = "bold 18px 'Meiryo', sans-serif";
    const INSTRUCTION_FONT = "16px 'Meiryo', sans-serif";

    // --- ★ログ設定 ---
    const ACTION_LOG_URL = "https://script.google.com/macros/s/AKfycbyEY0cnE-qSG1KH3UUXpaEmbu4OLATEz9Rd3rIcR2omKeKROYsHdYAVFMC_CBVVnDh1qg/exec"; 
    const APP_ID = 3;

    // --- 正解データ設定 ---
    // 質量1.5kg, 上から3.0Nの力
    const CORRECT_ANSWERS = [
        {
            objectId: 'box1', 
            vectors: [
                { name: "重力", fx: 0, fy: 15, startPosType: 'center' },       // 15N
                { name: "指で押す力", fx: 0, fy: 3, startPosType: 'top-12,5' },     // 3N (下向き)
                { name: "床からの垂直抗力", fx: 0, fy: -18, startPosType: 'bottom+12,-5' }, // 18N (上向き)
            ]
        }
    ];

    // --- 状態管理変数 ---
    let isRunning = false;
    let isDrawingVector = false;
    let vectorStartPos = null;
    let currentMousePos = { x: 0, y: 0 };
    let targetObject = null; 
    let validationTimer = null;

    let box1;
    let box1Vectors = [];
    let forceTextStamps = [];

    let calculatedMass1 = 0.0;
    let showMassText = false;
    
    let generalErrorCount = 0; // ★追加：エラーカウント変数

    // --- クラス定義 ---
    class PhysicsObject {
        constructor(x, y, w, h, m, c) {
            this.x = x; this.y = y; this.width = w; this.height = h;
            this.mass = m; this.color = c;
            this.vx = 0; this.vy = 0; this.ax = 0; this.ay = 0;
            this.initialRect = { x: x, y: y, width: w, height: h };
        }
        update() { this.vx += this.ax; this.vy += this.ay; this.x += this.vx; this.y += this.vy; }
        draw(ctx) {
            ctx.fillStyle = this.color; ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.strokeStyle = 'black'; ctx.lineWidth = 1; ctx.strokeRect(this.x, this.y, this.width, this.height);
        }
        collidesWith(p) {
            return p.x >= this.initialRect.x && p.x <= this.initialRect.x + this.initialRect.width &&
                   p.y >= this.initialRect.y && p.y <= this.initialRect.y + this.initialRect.height;
        }
    }
    class ForceVector {
        constructor(startPos, vx, vy, color) { this.startPos = startPos; this.vx = vx; this.vy = vy; this.color = color; }
        draw(ctx, offsetX = 0, offsetY = 0) {
            ctx.strokeStyle = this.color; ctx.lineWidth = VECTOR_WIDTH;
            drawVector(ctx, this.startPos.x + offsetX, this.startPos.y + offsetY, this.startPos.x + this.vx + offsetX, this.startPos.y + this.vy + offsetY);
        }
    }
    class ForceText {
        constructor(text, pos) { this.text = text; this.pos = pos; }
        draw(ctx) { ctx.fillStyle = 'black'; ctx.font = BUTTON_FONT; ctx.fillText(this.text, this.pos.x, this.pos.y); }
    }

    // --- メインロジック ---
    function createObjectStates(needLog = true) {
        try {
            if (needLog && box1Vectors && box1Vectors.length > 0) {
                sendActionLog(0); 
            }
        } catch (e) {
            console.error("Log error:", e);
        }

        if (validationTimer) clearTimeout(validationTimer);
        const box1Width = 120, box1Height = 120, box1Mass = 1.5;
        const box1InitialX = SCREEN_WIDTH / 2.0 - box1Width / 2.0;
        const box1InitialY = floorRect.y - box1Height;
        box1 = new PhysicsObject(box1InitialX, box1InitialY, box1Width, box1Height, box1Mass, 'rgb(100, 255, 100)');
        
        isRunning = false;
        box1Vectors = []; forceTextStamps = [];
        showMassText = false;
        calculatedMass1 = 0.0;
        targetObject = null; 
    }

    function undoLastAction() {
        if (box1Vectors.length === 0) return; 

        try {
            sendActionLog(2);
        } catch (e) {
            console.error("Log error:", e);
        }

        box1Vectors.pop();     
        forceTextStamps.pop(); 
    }

    function startSimulation() {
        if (isRunning) return;

        try {
            sendActionLog(1); 
        } catch (e) {
            console.error("Log error:", e);
        }

        const bottomPos = getTargetPos(box1, 'bottom');
        const netForceVX1 = box1Vectors.reduce((sum, v) => sum + v.vx, 0);
        let netForceVY1 = box1Vectors.reduce((sum, v) => sum + v.vy, 0);
        let downwardVectors1 = box1Vectors.filter(v => v.vy > 0).reduce((sum, v) => sum + v.vy, 0);
        let upwardVectors1 = box1Vectors.filter(v => 
            v.vy < 0 && Math.abs(v.startPos.y - bottomPos.y) < 15.0
        ).reduce((sum, v) => sum + v.vy, 0);

        let netForceN_VX1 = netForceVX1 * FORCE_SCALE_FACTOR;
        let netForceN_VY1 = netForceVY1 * FORCE_SCALE_FACTOR;
        
        let netupwardVectors1 = upwardVectors1 * FORCE_SCALE_FACTOR;

        let netForceN_VY1_pygame = -netForceN_VY1;

        box1.ax = (netForceN_VX1 * FORCE_SCALE_FACTOR) / box1.mass;
        box1.ay = (netForceN_VY1 * FORCE_SCALE_FACTOR) / box1.mass;

        if (Math.abs(netForceN_VX1) < 0.09 && Math.abs(netForceN_VY1) < 0.09) { box1.ax = 0; box1.ay = 0; }

        if (netForceN_VY1_pygame < 0) {
            calculatedMass1 = -1 * netupwardVectors1 / GRAVITY_ACCELERATION;
        } else if (netForceN_VY1_pygame >= 0 && netForceN_VY1_pygame < 0.09) {
            calculatedMass1 = -1 * netupwardVectors1 / GRAVITY_ACCELERATION;
        } else {
            calculatedMass1 = 0;
        }
        
        showMassText = true;
        isRunning = true;

        if (validationTimer) clearTimeout(validationTimer);
        
        validationTimer = setTimeout(() => {
            const isCorrect = checkAnswer(); 
            if (!isCorrect) {
                isRunning = false;
                createObjectStates(false);
            }
        }, 1000); 
    }

    function updateSimulation() {
        if (!isRunning) return;
        box1.update();
    }
   
    function drawSimulation() {
        ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        const userName = sessionStorage.getItem('physics_app_username') || "ゲスト";
        ctx.fillStyle = '#555'; ctx.font = "14px 'Meiryo', sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`学習者: ${userName}`, SCREEN_WIDTH - 20, 30); ctx.textAlign = "left"; 
        ctx.fillStyle = FLOOR_COLOR; ctx.fillRect(floorRect.x, floorRect.y, floorRect.width, floorRect.height);
        ctx.fillStyle = 'black'; ctx.font = INSTRUCTION_FONT;
        ctx.fillText("上から3.0Nの力で押されて床の上で静止している質量1.5kgの緑色の物体にはたらく力を", 10, 25);
        ctx.fillText("作図して再生ボタンを押してみましょう。100gの物体にはたらく力の大きさを１Nとする。", 10, 45);
        ctx.fillText("また、灰色の床ははかりになっている。", 10, 65);

        box1.draw(ctx);
        drawSnapPoints(ctx, box1, 'rgba(0, 200, 0, 0.4)'); 

        if (isFingerImageLoaded) {
            const fingerWidth = 80; const fingerHeight = 100;
            const fingerX = box1.x + (box1.width / 2) - (fingerWidth / 2) - 21; 
            const fingerY = box1.y - fingerHeight + 3; 
            ctx.drawImage(fingerImage, fingerX, fingerY, fingerWidth, fingerHeight);
        }

        const startPosCounts = {}; 
        const drawWithOffset = (vectorList) => {
            vectorList.forEach(v => {
                const key = `${v.startPos.x},${v.startPos.y}`;
                const count = startPosCounts[key] || 0;
                let offset = 0;
                if (count > 0) {
                    const gap = 12; const sign = (count % 2 === 1) ? 1 : -1;
                    const multiplier = Math.ceil(count / 2.0);
                    offset = multiplier * gap * sign;
                }
                v.draw(ctx, offset, 0); startPosCounts[key] = count + 1;
            });
        };
        drawWithOffset(box1Vectors);
        
        if (isDrawingVector && vectorStartPos) {
            const snappedComponents = snapVectorComponents(vectorStartPos, currentMousePos);
            const snappedEndPosX = vectorStartPos.x + snappedComponents.vx;
            const snappedEndPosY = vectorStartPos.y + snappedComponents.vy;
            ctx.strokeStyle = VECTOR_COLORS[0]; ctx.lineWidth = VECTOR_WIDTH;
            drawVector(ctx, vectorStartPos.x, vectorStartPos.y, snappedEndPosX, snappedEndPosY);
            const mag = Math.sqrt(snappedComponents.vx**2 + snappedComponents.vy**2) * FORCE_SCALE_FACTOR;
            ctx.fillStyle = 'black'; ctx.font = BUTTON_FONT;
            ctx.fillText(`${mag.toFixed(1)} N`, snappedEndPosX + 50, snappedEndPosY -20);
        }
        forceTextStamps.forEach(t => t.draw(ctx));
        if (showMassText) {
            ctx.font = BUTTON_FONT; ctx.fillStyle = 'black';
            ctx.fillText(`灰色の床がはかる重さ: ${calculatedMass1.toFixed(2)} kg`, 10, 390);
        }
        
        drawButton(ctx, startButtonRect, START_BUTTON_COLOR_IDLE, "再生");
        drawButton(ctx, undoButtonRect,  UNDO_BUTTON_COLOR_IDLE,  "1つ戻る");
        drawButton(ctx, resetButtonRect, RESET_BUTTON_COLOR_IDLE, "リセット");
    }

    // --- ヘルパー関数群 ---
    function getSnapPoints(box) {
        const rect = box.initialRect; const cx = rect.x + rect.width / 2; const cy = rect.y + rect.height / 2;
        return [{ x: cx, y: cy }, { x: cx-12, y: rect.y+5 }, { x: cx+12, y: rect.y + rect.height-5 }, { x: rect.x+5, y: cy }, { x: rect.x + rect.width-5, y: cy }];
    }
    function getNearestSnapPoint(p, box) {
        const snapPoints = getSnapPoints(box); let minDistance = Infinity; let nearestPoint = null;
        for (const sp of snapPoints) {
            const dist = getDistance(p, sp);
            if (dist < minDistance) { minDistance = dist; nearestPoint = sp; }
        } return nearestPoint;
    }
    function drawVector(ctx, x1, y1, x2, y2) {
        if (x1 === x2 && y1 === y2) return;
        ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        const angle = Math.atan2(y2 - y1, x2 - x1); const arrowheadLength = 10;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowheadLength * Math.cos(angle - Math.PI / 6), y2 - arrowheadLength * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowheadLength * Math.cos(angle + Math.PI / 6), y2 - arrowheadLength * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }
    function drawButton(ctx, rect, color, text) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.width, rect.height, [5]); ctx.fill();
        ctx.fillStyle = 'black'; ctx.font = BUTTON_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    function snapVectorComponents(start, end) {
        const vx = end.x - start.x; const vy = end.y - start.y;
        if (vx === 0 && vy === 0) return { vx: 0, vy: 0 };
        const angleRad = Math.atan2(vy, vx); const magnitude = Math.sqrt(vx * vx + vy * vy);
        const snappedMagnitude = (Math.round((magnitude * FORCE_SCALE_FACTOR) / 0.5) * 0.5) / FORCE_SCALE_FACTOR;
        const snapAngle = Math.PI / 6.0; const snappedAngleRad = Math.round(angleRad / snapAngle) * snapAngle;
        return { vx: snappedMagnitude * Math.cos(snappedAngleRad), vy: snappedMagnitude * Math.sin(snappedAngleRad) };
    }
    function getDistance(p1, p2) { return Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2); }
    function isPointInRect(p, rect) { return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height; }
    function getPos(e) {
        const rect = canvas.getBoundingClientRect(); let clientX, clientY;
        if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; } 
        else if (e.changedTouches && e.changedTouches.length > 0) { clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY; } 
        else { clientX = e.clientX; clientY = e.clientY; }
        return { x: clientX - rect.left, y: clientY - rect.top };
    }
    function getTargetPos(box, typeString) {
        const r = box.initialRect; const cx = r.x + r.width / 2; const cy = r.y + r.height / 2;
        let type = typeString; let offsetX = 0; let offsetY = 0;
        const match = typeString.match(/^([a-z]+)(.*)$/);
        if (match) {
            type = match[1]; const offsetPart = match[2];
            if (offsetPart) {
                if (offsetPart.includes(',')) { const parts = offsetPart.split(','); offsetX = parseInt(parts[0], 10) || 0; offsetY = parseInt(parts[1], 10) || 0; } 
                else { offsetY = parseInt(offsetPart, 10) || 0; }
            }
        }
        let basePos = { x: cx, y: cy };
        switch (type) {
            case 'center': basePos = { x: cx, y: cy }; break; case 'top': basePos = { x: cx, y: r.y }; break;
            case 'bottom': basePos = { x: cx, y: r.y + r.height }; break; case 'left': basePos = { x: r.x, y: cy }; break;
            case 'right': basePos = { x: r.x + r.width, y: cy }; break; default: basePos = { x: cx, y: cy }; break;
        } return { x: basePos.x + offsetX, y: basePos.y + offsetY };
    }
    function drawSnapPoints(ctx, box, color) {
        const snapPoints = getSnapPoints(box);
        ctx.fillStyle = color;
        snapPoints.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); 
            ctx.fill();
        });
    }

    // --- ★ヒントクイズ生成関数（完全版） ---
    // isSpecificError が true の場合は2問目（ステップ2）で終了する
    function showHintQuizModal(step, isSpecificError = false) {
        const existing = document.getElementById('hintModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'hintModal';
        modal.style.position = 'fixed';
        modal.style.top = '0'; modal.style.left = '0'; 
        modal.style.width = '100%'; modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        modal.style.display = 'flex'; 
        modal.style.justifyContent = 'center'; 
        modal.style.alignItems = 'center';
        modal.style.zIndex = '1000';

        const content = document.createElement('div');
        content.style.backgroundColor = 'white';
        content.style.padding = '25px';
        content.style.borderRadius = '10px';
        content.style.textAlign = 'center';
        content.style.width = '380px';
        content.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';

        const title = document.createElement('h2');
        title.style.margin = '0 0 15px 0';
        title.style.fontSize = '18px';

        const quizImg = document.createElement('img');
        quizImg.src = 'quiz_2.PNG'; 
        quizImg.style.width = '100%';
        quizImg.style.height = 'auto';
        quizImg.style.maxWidth = '180px'; 
        quizImg.style.borderRadius = '6px';
        quizImg.style.border = '1px solid #ddd';
        quizImg.style.marginBottom = '20px';

        const buttonsDiv = document.createElement('div');
        buttonsDiv.style.display = 'flex';
        buttonsDiv.style.flexDirection = 'column';
        buttonsDiv.style.gap = '10px';

        if (step === 1) {
            title.innerText = "ヒント1：上から指で押されて静止しているこの物体にはたらく力は何だろう？";
            const options = [
                { text: "重力と垂直抗力", correct: false, msg: "物体は指で上から押されているよ。" },
                { text: "重力と指で押す力", correct: false, msg: "床から支えられないと、物体は下に沈んでいってしまうよ。" },
                { text: "重力と垂直抗力と指から受ける力", correct: true, msg: "" },
                { text: "垂直抗力と指から受ける力", correct: false, msg: "質量のある物体には、必ず地球から引っ張られる力がはたらくよ。" }
            ];
            options.forEach(opt => {
                const btn = document.createElement('button');
                btn.innerText = opt.text;
                btn.style.padding = '12px'; btn.style.fontSize = '16px'; btn.style.cursor = 'pointer';
                btn.onclick = () => {
                    if (opt.correct) {
                        // ★特定エラーでも通常でも、正解したら必ずステップ2へ進む！
                        alert("正解！物体には下向きの「重力」と「指から受ける力」、そして上向きに「垂直抗力」の3つがはたらいています。\n続いて、力の大きさについて考えてみよう！");
                        showHintQuizModal(2, isSpecificError); 
                    } else {
                        alert("もう一度よく考えてみよう！\n" + opt.msg);
                    }
                };
                buttonsDiv.appendChild(btn);
            });
        } else if (step === 2) {
            title.innerText = "ヒント2：この問題の場合、物体にはたらく重力の大きさは何Nだろう？";
            const subText = document.createElement('p');
            subText.innerText = "（質量1.5kg、100gにはたらく力を1.0Nとする）";
            subText.style.fontSize = '14px'; subText.style.color = '#555'; subText.style.marginBottom = '20px';
            content.appendChild(subText);

            const options = [
                { text: "1.5 N", correct: false, msg: "1.5kg は何gか計算してみよう。" },
                { text: "10 N", correct: false, msg: "それは質量1.0kgのときの重力だね。" },
                { text: "15 N", correct: true, msg: "" },
                { text: "18 N", correct: false, msg: "上から押される力を足していませんか？" }
            ];
            options.forEach(opt => {
                const btn = document.createElement('button');
                btn.innerText = opt.text;
                btn.style.padding = '12px'; btn.style.fontSize = '16px'; btn.style.cursor = 'pointer';
                btn.onclick = () => {
                    if (opt.correct) {
                        // ★特定エラー（18N・18Nのミス）の場合は、ここで作図に戻す！
                        if (isSpecificError) {
                            alert("大正解！\n1.5kg = 1500g だから、重力は 15N になるね。\n力の種類と大きさがわかりましたね！それではもう一度気をつけて力を作図してみよう！");
                            modal.remove(); 
                        } else {
                            // 通常の5回ミスの場合は、最後のステップ3へ進む
                            alert("大正解！\n1.5kg = 1500g だから、重力は 15N になるね。\nそれでは、最後のステップで床からの力を考えてみよう！");
                            showHintQuizModal(3, isSpecificError); 
                        }
                    } else {
                        alert("惜しい！\n" + opt.msg + "\n100gで1.0Nということは、1.5㎏（1500g）ではどうなるかな？");
                    }
                };
                buttonsDiv.appendChild(btn);
            });
        } else if (step === 3) {
            title.innerText = "ヒント3：このとき床からの垂直抗力は何Nになるだろう？";
            const subText = document.createElement('p');
            subText.innerText = "（下向きに重力15.0Nと指で押す力3.0Nがはたらいて、物体は静止しています）";
            subText.style.fontSize = '14px'; subText.style.color = '#555'; subText.style.marginBottom = '15px';
            content.appendChild(subText);

            const options = [
                { text: "3.0 N", correct: false, msg: "それだと下に沈んでしまうよ。" },
                { text: "15 N", correct: false, msg: "それだと下に沈んでしまうよ。" },
                { text: "12 N", correct: false, msg: "それだと下に沈んでしまうよ。" },
                { text: "18 N", correct: true, msg: "" }
            ];
            options.forEach(opt => {
                const btn = document.createElement('button');
                btn.innerText = opt.text;
                btn.style.padding = '12px'; btn.style.fontSize = '16px'; btn.style.cursor = 'pointer';
                btn.onclick = () => {
                    if (opt.correct) {
                        alert("大正解！\n下向きの力の合計（重力15N + 指の力3N = 18N）と、上向きの垂直抗力がつり合います。\nつまり垂直抗力は18Nになりますね。それではもう一度力を作図してみよう！");
                        modal.remove(); 
                    } else {
                        alert("惜しい！\n" + opt.msg + "\n物体が静止しているとき、力はつり合っています。");
                    }
                };
                buttonsDiv.appendChild(btn);
            });
        }

        content.appendChild(title);
        content.appendChild(quizImg);
        content.appendChild(buttonsDiv);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    // --- イベントリスナー ---
    function handleStart(e) {
        e.preventDefault(); const p = getPos(e); currentMousePos = p; targetObject = null; isDrawingVector = false;
        if (isPointInRect(p, startButtonRect)) { startSimulation(); } 
        else if (isPointInRect(p, undoButtonRect)) { undoLastAction(); } 
        else if (isPointInRect(p, resetButtonRect)) { createObjectStates(); } 
        else if (box1.collidesWith(p)) { isDrawingVector = true; targetObject = box1; vectorStartPos = getNearestSnapPoint(p, box1); } 
    }
    function handleEnd(e) {
        e.preventDefault();
        if (!isDrawingVector || !targetObject) { isDrawingVector = false; targetObject = null; return; }
        isDrawingVector = false; const endPos = getPos(e);
        const snappedComponents = snapVectorComponents(vectorStartPos, endPos);
        if (Math.abs(snappedComponents.vx) < 0.1 && Math.abs(snappedComponents.vy) < 0.1) { targetObject = null; return; }
        const color = VECTOR_COLORS[0];
        const snappedMagnitude = Math.sqrt(snappedComponents.vx**2 + snappedComponents.vy**2);
        const magText = `${(snappedMagnitude * FORCE_SCALE_FACTOR).toFixed(1)} N`;
        const snappedEndPosX = vectorStartPos.x + snappedComponents.vx;
        const snappedEndPosY = vectorStartPos.y + snappedComponents.vy;
        forceTextStamps.push(new ForceText(magText, { x: snappedEndPosX + 15, y: snappedEndPosY + 15 }));
        if (targetObject === box1) { box1Vectors.push(new ForceVector(vectorStartPos, snappedComponents.vx, snappedComponents.vy, color)); } 
        targetObject = null;
    }
    function handleMove(e) {
        e.preventDefault(); currentMousePos = getPos(e); const p = currentMousePos;
        if (isPointInRect(p, startButtonRect) || isPointInRect(p, undoButtonRect) || isPointInRect(p, resetButtonRect)) { 
            canvas.style.cursor = 'pointer'; 
        } else { canvas.style.cursor = 'crosshair'; }
    }
    canvas.addEventListener('mousedown', handleStart, { passive: false }); canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('mouseup', handleEnd, { passive: false }); canvas.addEventListener('touchend', handleEnd, { passive: false });
    canvas.addEventListener('mousemove', handleMove, { passive: false }); canvas.addEventListener('touchmove', handleMove, { passive: false });

    // --- 正誤判定と誤概念スキャン ---
    function checkAnswer() {
        let allCorrect = true;
        CORRECT_ANSWERS.forEach(answerSet => {
            let userVectors = []; let targetBox = null;
            if (answerSet.objectId === 'box1') { userVectors = box1Vectors; targetBox = box1; } 
            
            // 長さが違っても下のエラースキャンを行わせるため、ここでは return せずに状態のみ記録
            if (userVectors.length !== answerSet.vectors.length) { allCorrect = false; }
            
            let remainingUserVectors = [...userVectors];
            answerSet.vectors.forEach(correctVec => {
                const correctStartPos = getTargetPos(targetBox, correctVec.startPosType);
                const foundIndex = remainingUserVectors.findIndex(uVec => {
                    const uFx_N = uVec.vx * FORCE_SCALE_FACTOR; const uFy_N = uVec.vy * FORCE_SCALE_FACTOR;
                    return Math.abs(uFx_N - correctVec.fx) < 0.2 && Math.abs(uFy_N - correctVec.fy) < 0.2 && Math.abs(uVec.startPos.x - correctStartPos.x) < 5.0 && Math.abs(uVec.startPos.y - correctStartPos.y) < 5.0;
                });
                if (foundIndex !== -1) { remainingUserVectors.splice(foundIndex, 1); } else { allCorrect = false; }
            });
        });

        if (allCorrect) { 
            generalErrorCount = 0; // 正解したらリセット
            alert("正解です！"); 
            window.location.href = "main.html"; 
            return true; 
        } else { 
            const userVectors = box1Vectors;
            const centerPos = getTargetPos(box1, 'center');
            const targetNormalPos = getTargetPos(box1, 'bottom+12,-5');
            const topPos = getTargetPos(box1, 'top');
            // 作用・反作用の混同（下向き3Nと上向き3Nを両方描くミス）を検知
            // 1. 指が押す力（上面から下向き3N）があるか
            const hasDownwardPush = userVectors.some(v => Math.abs(v.vx*FORCE_SCALE_FACTOR - 0) < 0.2 && Math.abs(v.vy*FORCE_SCALE_FACTOR - 3) < 0.2 && Math.abs(v.startPos.x - (centerPos.x - 12)) < 5.0 && Math.abs(v.startPos.y - (topPos.y + 5)) < 5.0);
            
            // 2. 指を押し返す力/反作用（上面から上向き3N）があるか
            const hasUpwardPushReaction = userVectors.some(v => Math.abs(v.vx*FORCE_SCALE_FACTOR - 0) < 0.2 && Math.abs(v.vy*FORCE_SCALE_FACTOR - (-3)) < 0.2 && Math.abs(v.startPos.x - (centerPos.x - 12)) < 5.0 && Math.abs(v.startPos.y - (topPos.y + 5)) < 5.0);

            // 両方描かれていたら、専用のアラートを出す
            if (hasDownwardPush && hasUpwardPushReaction) {
                generalErrorCount = 0; // カウントリセット
                alert("ヒント：指で押す力（下向き3.0N）と一緒に、上向きの3.0Nの力が描かれていますね。もしかして、物体が指を押し返す力（反作用）を描いていませんか？\n今作図しているのは「緑色の物体」にはたらく力だけです。物体が指を押し返す力は「指」にはたらく力なので、緑色の物体にはたらく力ではありません。");
                return false;
            }

            // 【特定の誤り：重力18N、垂直抗力18Nの2本のみの組み合わせを検知】
            if (userVectors.length === 2) {
                const hasGravity18 = userVectors.some(v => Math.abs(v.vx*FORCE_SCALE_FACTOR - 0) < 0.2 && Math.abs(v.vy*FORCE_SCALE_FACTOR - 18) < 0.2 && Math.abs(v.startPos.x - centerPos.x) < 5.0 && Math.abs(v.startPos.y - centerPos.y) < 5.0);
                const hasNormal18 = userVectors.some(v => Math.abs(v.vx*FORCE_SCALE_FACTOR - 0) < 0.2 && Math.abs(v.vy*FORCE_SCALE_FACTOR - (-18)) < 0.2 && Math.abs(v.startPos.x - targetNormalPos.x) < 5.0 && Math.abs(v.startPos.y - targetNormalPos.y) < 5.0);

                if (hasGravity18 && hasNormal18) {
                    generalErrorCount = 0;
                    showHintQuizModal(1, true); // ★ 2問連続（ステップ2で終了）のクイズを表示
                    return false;
                }
            }

            // 【一般的な誤りが続いた場合】
            generalErrorCount++;
            if (generalErrorCount >= 5) {
                generalErrorCount = 0;
                showHintQuizModal(1, false); // ★ 3ステップのクイズを開始
            } else {
                alert("不正解です。作図の大きさや向き、位置を見直してみましょう。");
            }
            return false; 
        }
    }

    // --- ★ログ送信関数 (エラー対策済み) ---
    function sendActionLog(actionType) {
        try {
            const consent = sessionStorage.getItem('physics_app_consent');
            if (consent !== 'true') return;

            if (!ACTION_LOG_URL) return;
            const userName = sessionStorage.getItem('physics_app_username') || "ゲスト";
            const allVectors = [...box1Vectors];
            const vectorData = allVectors.map(v => ({
                start: { x: v.startPos.x, y: v.startPos.y },
                end:   { x: v.startPos.x + v.vx, y: v.startPos.y + v.vy }
            }));
            const data = { name: userName, appId: APP_ID, actionType: actionType, vectors: vectorData };
            if (navigator.sendBeacon) { navigator.sendBeacon(ACTION_LOG_URL, new Blob([JSON.stringify(data)], { type: 'text/plain' })); } 
            else { fetch(ACTION_LOG_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(data) }).catch(e => console.error(e)); }
        } catch(e) { console.error("Send log error:", e); }
    }

    // --- アニメーションループ ---
    function gameLoop() {
        updateSimulation();
        drawSimulation();
        requestAnimationFrame(gameLoop);
    }

    createObjectStates(); 
    gameLoop();           
});