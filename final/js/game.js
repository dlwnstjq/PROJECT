// =======================================================
// game.js - 로비 + 게임 통합 (일시정지 기능 포함)
// =======================================================

// -------------------------------------------------------
// [로비] 전역 변수
// -------------------------------------------------------
let gameBgmAudio = null;
let _currentSongId = '';
let _currentDiff = 'normal';
let _onExitCallback = null;

// -------------------------------------------------------
// [게임] gg/script.js 전역 상태 
// -------------------------------------------------------
let canvas, context;
let healthFill, healthSlot, playScreen, scoreBox, comboBox, judgementDisplay;

let score = 0, combo = 0, hp = 100;
let totalNotes = 0, hitNotes = 0, maxCombo = 0;

const ball = {
    x: 250, y: 480, radius: 8,
    type: 'normal', tailLength: 0, specialLocked: false,
    speedX: 0, speedY: 0,
    attached: true, heldOnPaddle: false,
    paddleOffsetX: 0, earlyMissed: false
};
const paddle = { x: 180, y: 520, width: 140, height: 12, isPressed: false };
let bricks = [], effects = [];

const JUDGE_LINE_Y = 520;
const PERFECT_WINDOW = 16;
const GOOD_WINDOW = 32;
const EFFECT_SPAWN_Y = 280;
const MAX_RADIUS = 45;
const NORMAL_MISS_HP = 20;
const MASH_MISS_HP = 12;
const MASH_MARKER_COUNT = 3;
const TAIL_EXTRUDE_SPEED = 6;
const BRICK_W = 52, BRICK_H = 22, BRICK_GAP = 6, BRICK_ROW_Y = 100;

let keyLeft = false, keyRight = false, keyPaddleHeld = false;
let pendingSpecial = null, tailGrow = null;
let activeHoldTail = null, activeMashTail = null;
let judgeTimer = null, comboTimer = null, damageTimer = null;
const approachTracker = { lastY: ball.y, isDescending: false };
let gameAnimId = null;
let isResultShowing = false;
let isPaused = false; // 일시정지 상태 관리 추가

// -------------------------------------------------------
// [게임] 함수들
// -------------------------------------------------------
const initTestBricks = () => {
    if (window.STAGE_DATA && window.STAGE_DATA.bricks) {
        const sd = window.STAGE_DATA;
        const rows = sd.bricks;
        const cols = rows[0].length;
        const totalW = cols * BRICK_W + (cols - 1) * BRICK_GAP;
        const startX = ((canvas ? canvas.width : 500) - totalW) / 2;
        bricks = [];
        for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < cols; c++) {
                const t = rows[r][c];
                if (!t || t === 'empty') continue;
                const tailByType = { hold: 140, mash: 150 };
                bricks.push({
                    x: startX + c * (BRICK_W + BRICK_GAP),
                    y: BRICK_ROW_Y + r * (BRICK_H + BRICK_GAP),
                    w: BRICK_W, h: BRICK_H,
                    type: t, tailLength: tailByType[t] || 0, alive: true
                });
            }
        }
        return;
    }
    const types = ['normal', 'hold', 'mash', 'normal'];
    const tailByType = { hold: 140, mash: 150 };
    const count = types.length;
    const totalW = count * BRICK_W + (count - 1) * BRICK_GAP;
    let startX = ((canvas ? canvas.width : 500) - totalW) / 2;
    bricks = [];
    for (let i = 0; i < types.length; i++) {
        let t = types[i];
        bricks.push({
            x: startX + i * (BRICK_W + BRICK_GAP), y: BRICK_ROW_Y,
            w: BRICK_W, h: BRICK_H,
            type: t, tailLength: tailByType[t] || 0, alive: true
        });
    }
};

const uiUpdateHealth = (hpValue) => {
    hp = hpValue;
    if (!healthFill) return;
    healthFill.style.height = hp + "%";
    if (hp <= 30) {
        healthFill.style.background = "linear-gradient(#ff0055 0%, #ff0000 100%)";
        healthFill.style.boxShadow = "0 0 25px #ff0055, inset 0 0 10px #ffffff";
        if (healthSlot) healthSlot.style.borderColor = "#ff0055";
        if (playScreen) { playScreen.style.borderColor = "#ff0055"; playScreen.style.boxShadow = "inset 0 0 60px rgba(255,0,85,0.25)"; }
    } else {
        healthFill.style.background = "linear-gradient(#00ffff 0%, #0088ff 100%)";
        healthFill.style.boxShadow = "0 0 20px #00ffff, inset 0 0 10px #ffffff";
        if (healthSlot) healthSlot.style.borderColor = "#00ffff";
        if (playScreen) { playScreen.style.borderColor = "#00ffff"; playScreen.style.boxShadow = "inset 0 0 40px rgba(0,255,255,0.15)"; }
    }
};

const uiUpdateScoreAndCombo = (sv, cv) => {
    score = sv; combo = cv;
    if (!scoreBox) return;
    let s = score.toString();
    while (s.length < 6) s = '0' + s;
    scoreBox.textContent = s;
    if (!comboBox) return;
    if (combo > 0) {
        animCombo();
        comboBox.innerHTML = combo + "<span>COMBO</span>";
        comboBox.style.opacity = "1";
    } else {
        comboBox.style.opacity = "0";
    }
};

const animDamage = () => {
    if (damageTimer) clearTimeout(damageTimer);
    if (!healthFill) return;
    healthFill.style.background = "#ffffff";
    healthFill.style.boxShadow = "0 0 40px #ffffff, inset 0 0 20px #ffffff";
    damageTimer = setTimeout(() => { uiUpdateHealth(hp); }, 100);
};

const animJudge = (text, judgeType) => {
    if (!judgementDisplay) return;
    judgementDisplay.textContent = text;
    judgementDisplay.classList.remove('judge-perfect', 'judge-good', 'judge-miss');
    judgementDisplay.classList.add(`judge-${judgeType}`);
    let frame = 0; const maxFrame = 25;
    if (judgeTimer) clearInterval(judgeTimer);
    const targetSize = 55;
    judgeTimer = setInterval(() => {
        frame++;
        if (frame <= 5) {
            judgementDisplay.style.opacity = 1;
            judgementDisplay.style.top = "35%";
            judgementDisplay.style.fontSize = (targetSize + 12 - 12 * (frame / 5)) + "px";
        } else if (frame <= maxFrame) {
            let p = (frame - 5) / 20;
            judgementDisplay.style.opacity = 1.0 - p;
            judgementDisplay.style.top = (35 - 5 * p) + "%";
            judgementDisplay.style.fontSize = (targetSize - 4 * p) + "px";
        } else { clearInterval(judgeTimer); }
    }, 16);
};

const animCombo = () => {
    if (!comboBox) return;
    const targetSize = 45;
    let currentSize = targetSize + 12;
    comboBox.style.color = "#ffffff";
    if (comboTimer) clearInterval(comboTimer);
    comboTimer = setInterval(() => {
        currentSize -= 2;
        if (currentSize <= targetSize) { currentSize = targetSize; comboBox.style.color = "#ff00ff"; clearInterval(comboTimer); }
        comboBox.style.fontSize = currentSize + "px";
    }, 16);
};

const uiShowJudgement = (judgeType) => {
    if (judgeType === 'miss') { animDamage(); animJudge("MISS", "miss"); }
    else if (judgeType === 'perfect') animJudge("PERFECT", "perfect");
    else if (judgeType === 'good') animJudge("GOOD", "good");
    else animJudge(judgeType, "perfect");
};

const uiHitParticle = (x, y) => { effects.push({ x, y, radius: 10, alpha: 1 }); };

const processJudgement = (type, options = {}) => {
    totalNotes++;
    if (type === 'perfect') { hitNotes++; score += 100 + (combo * 10); combo++; hp = Math.min(100, hp + 2); }
    else if (type === 'good') { hitNotes++; score += 50; combo++; hp = Math.min(100, hp + 1); }
    else if (type === 'miss') { combo = 0; hp = Math.max(0, hp - (options.light ? MASH_MISS_HP : NORMAL_MISS_HP)); }
    if (combo > maxCombo) maxCombo = combo;
    uiUpdateScoreAndCombo(score, combo);
    uiUpdateHealth(hp);
    uiShowJudgement(type);
};

const launchBallFromPaddle = () => {
    ball.attached = false; ball.heldOnPaddle = false; ball.earlyMissed = false;
    ball.x = paddle.x + paddle.width / 2;
    ball.y = paddle.y - ball.radius - 2;
    ball.speedX = 0; ball.speedY = -6;
};

const bounceBall = () => {
    ball.attached = false; ball.heldOnPaddle = false; ball.earlyMissed = false;
    ball.speedY = -6;
    ball.speedX = ((ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2)) * 4;
    ball.type = 'normal'; ball.tailLength = 0; ball.specialLocked = false; tailGrow = null;
};

const dropHeldBall = () => {
    if (ball.heldOnPaddle) { ball.heldOnPaddle = false; ball.speedY = 3; ball.type = 'normal'; ball.tailLength = 0; tailGrow = null; }
};

const getTravelDir = (vx, vy) => { let l = Math.sqrt(vx*vx+vy*vy); return l < 0.01 ? {x:0,y:1} : {x:vx/l,y:vy/l}; };
const getTailBackDir = (vx, vy) => { let t = getTravelDir(vx,vy); return {x:-t.x,y:-t.y}; };
const tailBackPoint = (hx,hy,bx,by,l) => ({x:hx+bx*l,y:hy+by*l});
const captureTailMotion = (vx,vy) => {
    let travel=getTravelDir(vx,vy), back=getTailBackDir(vx,vy), speed=Math.sqrt(vx*vx+vy*vy)||3;
    return {moveX:travel.x,moveY:travel.y,backX:back.x,backY:back.y,speed};
};

const startHoldTailFromBall = () => {
    let tailLen = getBallTailDisplayLength() || ball.tailLength;
    let motion = captureTailMotion(ball.speedX, ball.speedY);
    let far = tailBackPoint(ball.x, ball.y, motion.backX, motion.backY, tailLen);
    activeHoldTail = { nearX:ball.x,nearY:ball.y,farX:far.x,farY:far.y, moveX:motion.moveX,moveY:motion.moveY,backX:motion.backX,backY:motion.backY, speed:motion.speed,missed:false,released:false,releaseWindow:false,absorbing:false };
};

const startMashTailFromBall = () => {
    let tailLen = getBallTailDisplayLength() || ball.tailLength;
    let motion = captureTailMotion(ball.speedX, ball.speedY);
    let spacing = tailLen / MASH_MARKER_COUNT;
    let markers = [];
    for (let i = 1; i <= MASH_MARKER_COUNT; i++) {
        let p = tailBackPoint(ball.x,ball.y,motion.backX,motion.backY,spacing*i);
        markers.push({x:p.x,y:p.y,state:'pending'});
    }
    activeMashTail = {anchorX:ball.x,anchorY:ball.y,moveX:motion.moveX,moveY:motion.moveY,backX:motion.backX,backY:motion.backY,speed:motion.speed,markers};
};

const captureBallToPaddle = () => {
    ball.heldOnPaddle = true; ball.paddleOffsetX = ball.x - paddle.x;
    ball.y = JUDGE_LINE_Y - ball.radius; ball.speedX = 0; ball.speedY = 0;
};

const getMashMarkerInWindow = () => {
    if (!activeMashTail) return null;
    let best = null;
    for (let m of activeMashTail.markers) {
        if (m.state==='pending' && m.x>=paddle.x && m.x<=paddle.x+paddle.width && Math.abs(m.y-JUDGE_LINE_Y)<=GOOD_WINDOW) {
            if (!best || m.y > best.y) best = m;
        }
    }
    return best;
};

const tryMashMarkerHit = () => {
    let marker = getMashMarkerInWindow();
    if (!marker) return false;
    processJudgement(Math.abs(marker.y - JUDGE_LINE_Y) <= PERFECT_WINDOW ? 'perfect' : 'good');
    uiHitParticle(marker.x, JUDGE_LINE_Y);
    marker.state = 'hit';
    return true;
};

const tryHoldTailRelease = () => {
    if (!activeHoldTail || activeHoldTail.missed || activeHoldTail.released) return;
    if (!activeHoldTail.releaseWindow) { processJudgement('miss'); dropHeldBall(); activeHoldTail=null; ball.earlyMissed = true; return; }
    let diff = Math.abs(activeHoldTail.farY - JUDGE_LINE_Y);
    let judge = diff<=PERFECT_WINDOW?'perfect':diff<=GOOD_WINDOW?'good':'miss';
    processJudgement(judge);
    if (judge !== 'miss') { uiHitParticle(activeHoldTail.farX,JUDGE_LINE_Y); if(ball.heldOnPaddle) bounceBall(); }
    else dropHeldBall();
    activeHoldTail = null;
};

const tryHoldTailReleaseOnOutsideMiss = () => { processJudgement('miss'); dropHeldBall(); activeHoldTail=null; ball.earlyMissed = true; };

const isSpecialStateBusy = () => ball.specialLocked || pendingSpecial || activeHoldTail || activeMashTail;

const gameOnSpecialBrickHit = (type, tailLength=160) => {
    if (type!=='hold'&&type!=='mash') return false;
    if (isSpecialStateBusy()) return false;
    pendingSpecial = {type,tailLength}; return true;
};

const queueSpecialNote = (type,tailLength) => { if (!isSpecialStateBusy()) pendingSpecial={type,tailLength}; };

const activatePendingSpecial = () => {
    if (!pendingSpecial || ball.attached || ball.heldOnPaddle || ball.speedY <= 0 || ball.y < EFFECT_SPAWN_Y) return;
    ball.type = pendingSpecial.type; ball.tailLength = pendingSpecial.tailLength; ball.specialLocked = true;
    let back = getTailBackDir(ball.speedX, ball.speedY);
    tailGrow = {length:pendingSpecial.tailLength,current:0,dirX:back.x,dirY:back.y,originX:ball.x,originY:ball.y};
    pendingSpecial = null;
};

const getBallTailDisplayLength = () => {
    if (ball.heldOnPaddle) return 0;
    if (tailGrow) return tailGrow.current;
    if (ball.type==='hold'||ball.type==='mash') return ball.tailLength;
    return 0;
};

const syncTailGrowDirection = () => {
    if (!tailGrow||ball.attached||ball.heldOnPaddle) return;
    let back = getTailBackDir(ball.speedX, ball.speedY);
    tailGrow.dirX=back.x; tailGrow.dirY=back.y;
};

const updateTailGrow = () => {
    if (tailGrow) {
        syncTailGrowDirection();
        if (tailGrow.current < tailGrow.length) {
            tailGrow.current = Math.min(tailGrow.length, tailGrow.current + TAIL_EXTRUDE_SPEED);
        }
    }
};

const resetBallState = () => {
    ball.attached=true; ball.heldOnPaddle=false; ball.earlyMissed=false;
    ball.speedX=0; ball.speedY=0; ball.type='normal'; ball.tailLength=0; ball.specialLocked=false;
    tailGrow=null; pendingSpecial=null; activeHoldTail=null; activeMashTail=null;
};

const checkBallBrickCollisions = () => {
    for (let brick of bricks) {
        if (!brick.alive) continue;
        if (ball.x+ball.radius<brick.x||ball.x-ball.radius>brick.x+brick.w) continue;
        if (ball.y+ball.radius<brick.y||ball.y-ball.radius>brick.y+brick.h) continue;
        brick.alive = false;
        let oL=(ball.x+ball.radius)-brick.x, oR=(brick.x+brick.w)-(ball.x-ball.radius);
        let oT=(ball.y+ball.radius)-brick.y, oB=(brick.y+brick.h)-(ball.y-ball.radius);
        let m = Math.min(oL,oR,oT,oB);
        if (m===oL){ball.speedX=-Math.abs(ball.speedX);ball.x=brick.x-ball.radius;}
        else if(m===oR){ball.speedX=Math.abs(ball.speedX);ball.x=brick.x+brick.w+ball.radius;}
        else if(m===oT){ball.speedY=-Math.abs(ball.speedY);ball.y=brick.y-ball.radius;}
        else{ball.speedY=Math.abs(ball.speedY);ball.y=brick.y+brick.h+ball.radius;}
        if (brick.type==='hold'||brick.type==='mash') gameOnSpecialBrickHit(brick.type,brick.tailLength);
        return;
    }
};

const uiSetPaddleActive = (isActive) => { paddle.isPressed = isActive; };

const gProcessTimeEvents = () => {
    if (!gameBgmAudio || !gameBgmAudio.src || gTimeEvents.length === 0) return;
    if (ball.attached || ball.heldOnPaddle || isSpecialStateBusy()) return;
    let curTime = gameBgmAudio.currentTime;
    while (gTimeEventIdx < gTimeEvents.length && gTimeEvents[gTimeEventIdx].time <= curTime) {
        let ev = gTimeEvents[gTimeEventIdx];
        gTimeEventIdx++;
        if (ev.type === 'long') { gLongEndTime = ev.end || ev.time + 2; queueSpecialNote('hold', 140); } 
        else if (ev.type === 'mash') { gMashEndTime = ev.end || ev.time + 2; queueSpecialNote('mash', 150); } 
        else if (ev.type === 'fake') { ball.type = 'fake'; }
        break;
    }
};

const updatePhysics = () => {
    if (keyLeft) paddle.x -= 4;
    if (keyRight) paddle.x += 4;
    if (paddle.x < 0) paddle.x = 0;
    if (paddle.x + paddle.width > canvas.width) paddle.x = canvas.width - paddle.width;

    gProcessTimeEvents();
    activatePendingSpecial();
    updateTailGrow();

    if (activeHoldTail) {
        let step = activeHoldTail.speed;
        if (!activeHoldTail.absorbing) {
            activeHoldTail.nearX+=activeHoldTail.moveX*step; activeHoldTail.nearY+=activeHoldTail.moveY*step;
            activeHoldTail.farX+=activeHoldTail.moveX*step; activeHoldTail.farY+=activeHoldTail.moveY*step;
        } else {
            activeHoldTail.farX+=activeHoldTail.moveX*step; activeHoldTail.farY+=activeHoldTail.moveY*step;
            if (activeHoldTail.nearY<JUDGE_LINE_Y) { activeHoldTail.nearX+=activeHoldTail.moveX*step; activeHoldTail.nearY+=activeHoldTail.moveY*step; }
        }
        if (keyPaddleHeld&&activeHoldTail.nearY>=JUDGE_LINE_Y-4) activeHoldTail.absorbing=true;
        if (!activeHoldTail.releaseWindow&&activeHoldTail.farY>=JUDGE_LINE_Y-GOOD_WINDOW) activeHoldTail.releaseWindow=true;
        if (!keyPaddleHeld&&!activeHoldTail.releaseWindow&&!activeHoldTail.missed&&!activeHoldTail.released){tryHoldTailReleaseOnOutsideMiss();return;}
        if (activeHoldTail&&activeHoldTail.releaseWindow&&keyPaddleHeld&&activeHoldTail.farY>JUDGE_LINE_Y+GOOD_WINDOW&&!activeHoldTail.released&&!activeHoldTail.missed){tryHoldTailReleaseOnOutsideMiss();return;}
        if (ball.heldOnPaddle&&(ball.x<paddle.x||ball.x>paddle.x+paddle.width)){tryHoldTailReleaseOnOutsideMiss();return;}
        if (activeHoldTail&&activeHoldTail.farY>canvas.height+100) {
            if (!activeHoldTail.releaseWindow) processJudgement('miss');
            activeHoldTail=null; ball.type='normal'; ball.specialLocked=false; tailGrow=null;
        }
    }

    if (activeMashTail) {
        let isTailActive=false, step=activeMashTail.speed, hasPending=false;
        activeMashTail.markers.forEach(marker => {
            if (marker.state==='pending') {
                marker.x+=activeMashTail.moveX*step; marker.y+=activeMashTail.moveY*step;
                isTailActive=true; hasPending=true;
                if (marker.y>JUDGE_LINE_Y+GOOD_WINDOW){processJudgement('miss',{light:true});marker.state='missed';}
            } else {
                marker.x+=activeMashTail.moveX*step; marker.y+=activeMashTail.moveY*step;
                if (marker.y<canvas.height+ball.radius) isTailActive=true;
            }
        });
        if (ball.heldOnPaddle&&(ball.x<paddle.x||ball.x>paddle.x+paddle.width)){processJudgement('miss');dropHeldBall();activeMashTail=null;hasPending=false;}
        if (!hasPending&&ball.heldOnPaddle) bounceBall();
        if (!isTailActive) { activeMashTail=null; if (!ball.heldOnPaddle) { ball.type='normal'; ball.specialLocked=false; tailGrow=null; } }
    }

    if (ball.attached) { ball.x=paddle.x+paddle.width/2; ball.y=paddle.y-ball.radius-2; }
    else if (ball.heldOnPaddle) { ball.y=JUDGE_LINE_Y-ball.radius; }
    else { ball.x+=ball.speedX; ball.y+=ball.speedY; }

    if (!ball.attached&&!ball.heldOnPaddle) {
        if (ball.x-ball.radius<0||ball.x+ball.radius>canvas.width) ball.speedX*=-1;
        if (ball.y-ball.radius<0) ball.speedY*=-1;
        checkBallBrickCollisions();
    }

    if (!ball.attached&&!ball.heldOnPaddle&&ball.type==='fake'&&ball.speedY>0) {
        let bBot=ball.y+ball.radius; let onX=ball.x>=paddle.x&&ball.x<=paddle.x+paddle.width;
        if (bBot>=paddle.y-paddle.height/2&&bBot<=paddle.y+paddle.height&&onX) {
            if (keyPaddleHeld) { processJudgement('miss'); } 
            else { processJudgement('perfect'); uiHitParticle(ball.x, paddle.y); }
            ball.speedY = -Math.abs(ball.speedY);
            ball.type = 'normal';
        }
    }

    if (!ball.attached&&ball.y>canvas.height){
        if(!ball.earlyMissed){
            processJudgement('miss');
        }
        resetBallState();
        approachTracker.lastY=ball.y;approachTracker.isDescending=false;
    }
};

const drawBricks = () => {
    bricks.forEach(brick => {
        if (!brick.alive) return;
        context.fillStyle='#1a1a22'; context.fillRect(brick.x,brick.y,brick.w,brick.h);
        let color=brick.type==='hold'?'#ffff00':brick.type==='mash'?'#ff00ff':'#00ffff';
        context.strokeStyle=color; context.lineWidth=2; context.strokeRect(brick.x,brick.y,brick.w,brick.h);
        if (brick.type==='hold'||brick.type==='mash'){context.fillStyle=color;context.font='9px Orbitron';context.fillText(brick.type==='hold'?'L':'M',brick.x+brick.w/2-4,brick.y+15);}
    });
};

const drawExtrudeTail = (hx,hy,length,dirX,dirY,color) => {
    if (length<=0) return;
    let end=tailBackPoint(hx,hy,dirX,dirY,length);
    context.beginPath();context.moveTo(end.x,end.y);context.lineTo(hx,hy);
    context.lineWidth=ball.radius*2;context.lineCap='round';context.strokeStyle=color;context.stroke();
};

const getBallTailDir = () => {
    if (tailGrow) return {x:tailGrow.dirX,y:tailGrow.dirY};
    if (ball.heldOnPaddle){
        if (activeHoldTail) return {x:activeHoldTail.backX,y:activeHoldTail.backY};
        if (activeMashTail) return {x:activeMashTail.backX,y:activeMashTail.backY};
    }
    return getTailBackDir(ball.speedX,ball.speedY);
};

const drawPaddle = () => {
    context.beginPath();context.moveTo(0,paddle.y);context.lineTo(canvas.width,paddle.y);
    context.lineWidth=1;context.strokeStyle='rgba(0,255,255,0.4)';context.stroke();
    if (paddle.isPressed){
        let g=context.createLinearGradient(paddle.x,0,paddle.x+paddle.width,0);
        g.addColorStop(0,'rgba(255,255,255,0.2)');g.addColorStop(0.5,'rgba(255,255,255,0)');g.addColorStop(1,'rgba(255,255,255,0.2)');
        context.fillStyle=g;context.fillRect(paddle.x,0,paddle.width,paddle.y);
    }
    context.fillStyle=paddle.isPressed?'#ffffff':'#000000';
    context.fillRect(paddle.x,paddle.y-(paddle.height/2),paddle.width,paddle.height);
    context.lineWidth=2;context.strokeStyle=paddle.isPressed?'#00ffff':'#ffffff';
    context.strokeRect(paddle.x,paddle.y-(paddle.height/2),paddle.width,paddle.height);
};

const drawApproachCircle = () => {
    if (ball.y>approachTracker.lastY) approachTracker.isDescending=true;
    else if (ball.y<approachTracker.lastY) approachTracker.isDescending=false;
    approachTracker.lastY=ball.y;
    if (!approachTracker.isDescending||ball.y<EFFECT_SPAWN_Y||ball.y>=paddle.y) return;
    let total=paddle.y-EFFECT_SPAWN_Y, cur=paddle.y-ball.y;
    if (total<=0||cur<=0) return;
    let ratio=cur/total, r=ball.radius+(MAX_RADIUS-ball.radius)*ratio;
    context.beginPath();context.arc(ball.x,ball.y,r,0,Math.PI*2);
    context.lineWidth=1.5;context.strokeStyle=`rgba(0,255,255,${0.3+(1-ratio)*0.5})`;context.stroke();
};

const render = () => {
    try {
        context.clearRect(0,0,canvas.width,canvas.height);
        updatePhysics();
        drawBricks();drawPaddle();drawApproachCircle();

        if (activeHoldTail){
            let nx=activeHoldTail.nearX,ny=activeHoldTail.absorbing?JUDGE_LINE_Y:activeHoldTail.nearY;
            let fx=activeHoldTail.farX,fy=Math.min(activeHoldTail.farY,JUDGE_LINE_Y);
            context.beginPath();context.moveTo(fx,fy);context.lineTo(nx,ny);
            context.lineWidth=ball.radius*2;context.lineCap='round';context.strokeStyle='#ffff00';context.stroke();
            if (activeHoldTail.absorbing&&paddle.isPressed){context.fillStyle='rgba(255,255,0,0.15)';context.fillRect(paddle.x,paddle.y-paddle.height,paddle.width,paddle.height);}
        }

        if (activeMashTail){
            let pending=activeMashTail.markers.filter(m=>m.state==='pending');
            if (pending.length>0){
                let far=pending[pending.length-1],near=pending[0];
                let lead=tailBackPoint(far.x,far.y,activeMashTail.backX,activeMashTail.backY,10);
                context.beginPath();context.moveTo(lead.x,lead.y);
                context.lineTo(ball.heldOnPaddle?ball.x:near.x,ball.heldOnPaddle?JUDGE_LINE_Y:near.y);
                context.lineWidth=ball.radius*2;context.lineCap='round';context.strokeStyle='#ff00ff';context.stroke();
            }
            activeMashTail.markers.forEach(m=>{
                context.beginPath();context.arc(m.x,m.y,ball.radius,0,Math.PI*2);
                if(m.state==='pending'){context.fillStyle='#ffffff';context.fill();}
                else if(m.state==='missed'){context.fillStyle='#444444';context.fill();context.strokeStyle='#ff00ff';context.lineWidth=1;context.stroke();}
            });
        }

        if (ball.type==='hold'||ball.type==='mash'){
            let dLen=getBallTailDisplayLength(),dir=getBallTailDir();
            let color=ball.type==='hold'?'#ffff00':'#ff00ff';
            drawExtrudeTail(ball.x,ball.y,dLen,dir.x,dir.y,color);
            if (ball.type==='mash'&&dLen>0){
                let sp=ball.tailLength/MASH_MARKER_COUNT;
                for(let i=1;i<=MASH_MARKER_COUNT;i++){
                    let d=sp*i;
                    if(d<=dLen){let p=tailBackPoint(ball.x,ball.y,dir.x,dir.y,d);context.beginPath();context.arc(p.x,p.y,ball.radius,0,Math.PI*2);context.fillStyle='#ffffff';context.fill();}
                }
            }
        }

        context.beginPath();context.arc(ball.x,ball.y,ball.radius,0,Math.PI*2);
        context.fillStyle=ball.type==='hold'?'#ffff00':ball.type==='mash'?'#ff00ff':ball.type==='fake'?'#b026ff':'#00ffff';
        context.fill();
        if (ball.type==='fake'){context.lineWidth=2;context.strokeStyle='#ffffff';context.stroke();}

        let nextEffects=[];
        for(let ef of effects){
            ef.radius+=5;ef.alpha-=0.08;
            context.beginPath();context.arc(ef.x,ef.y,ef.radius,0,Math.PI*2);
            context.lineWidth=2;context.strokeStyle=`rgba(255,255,255,${ef.alpha})`;context.stroke();
            if(ef.alpha>0) nextEffects.push(ef);
        }
        effects=nextEffects;

        if(hp<=0){
            let gr=document.querySelector('.gameresult');if(gr)gr.textContent='STAGE OVER !';
            showResult();return;
        }
        if(bricks.length>0&&bricks.every(b=>!b.alive)){
            let gr=document.querySelector('.gameresult');if(gr)gr.textContent='STAGE CLEAR !';
            showResult();return;
        }
    } catch(err) {
        console.error('render error:', err);
    }
    gameAnimId=requestAnimationFrame(render);
};

// -------------------------------------------------------
// [게임] 결과/재시작/이동 및 일시정지 함수
// -------------------------------------------------------
function togglePause() {
    isPaused = !isPaused;
    let po = document.getElementById('pauseOverlay');
    if (!po) return;
    
    if (isPaused) {
        po.classList.add('show');
        if (gameBgmAudio) gameBgmAudio.pause();
        if (gameAnimId) { cancelAnimationFrame(gameAnimId); gameAnimId = null; }
    } else {
        po.classList.remove('show');
        document.activeElement.blur(); // 스페이스바 중복입력 방지
        if (gameBgmAudio) gameBgmAudio.play().catch(()=>{});
        gameAnimId = requestAnimationFrame(render);
    }
}

function showResult(){
    if(gameAnimId){cancelAnimationFrame(gameAnimId);gameAnimId=null;}
    if(gameBgmAudio){gameBgmAudio.pause();}
    isResultShowing = true;

    let isWin = hp>0 && bricks.every(b=>!b.alive);
    let isGameClear = isWin && _currentDiff.toLowerCase() === 'hard';
    let acc = totalNotes>0 ? Math.floor(hitNotes/totalNotes*10000)/100 : 0.0;
    let rank, rankClass;
    if(acc>=95){rank='S';rankClass='rank-s';}
    else if(acc>=85){rank='A';rankClass='rank-a';}
    else if(acc>=70){rank='B';rankClass='rank-b';}
    else if(acc>=55){rank='C';rankClass='rank-c';}
    else{rank='D';rankClass='rank-d';}

    let songNames={'badapple':'Bad Apple!!','spyout2':'SPY OUT2','loveofthemoon':'月哀 (월애)'};
    let songName=songNames[_currentSongId]||_currentSongId;

    let gr=document.querySelector('.gameresult');
    if(gr){if(isGameClear)gr.textContent='GAME CLEAR';else if(isWin)gr.textContent='STAGE CLEAR';else gr.textContent='STAGE OVER';}
    let si=document.getElementById('resultSongInfo');
    if(si)si.textContent=songName+' — '+_currentDiff.toUpperCase();
    let rl=document.getElementById('resultRankLetter');
    if(rl){rl.textContent=rank;rl.className='rank-letter '+rankClass;}
    let el=document.getElementById('result-score'); if(el)el.textContent=score;
    let em=document.getElementById('result-maxcombo'); if(em)em.textContent=maxCombo;
    let ea=document.getElementById('result-accuracy'); if(ea)ea.textContent=acc+'%';

    let key='best_'+_currentSongId+'_'+_currentDiff;
    let prev=JSON.parse(localStorage.getItem(key)||'{"score":0,"combo":0}');
    if(score>prev.score)prev.score=score;
    if(maxCombo>prev.combo)prev.combo=maxCombo;
    localStorage.setItem(key,JSON.stringify(prev));

    if(isWin){let ca=document.getElementById('clearAudio');if(ca){ca.currentTime=0;ca.volume=0.3;ca.play().catch(()=>{});}}

    let retryBtn=document.getElementById('resultRetryBtn');
    let nextBtn=document.getElementById('resultNextBtn');
    if(isGameClear){
        if(retryBtn)retryBtn.style.display='none';
        if(nextBtn)nextBtn.style.display='none';
    } else if(isWin){
        if(retryBtn)retryBtn.style.display='none';
        if(nextBtn)nextBtn.style.display='';
    } else {
        if(retryBtn)retryBtn.style.display='';
        if(nextBtn)nextBtn.style.display='none';
    }

    let ro=document.querySelector('.result-overlay');if(ro)ro.classList.add('show');
}

function retryGame(){
    isResultShowing = false;
    isPaused = false;
    document.activeElement.blur();
    keyPaddleHeld=false;keyLeft=false;keyRight=false;uiSetPaddleActive(false);
    maxCombo=0;totalNotes=0;hitNotes=0;score=0;combo=0;hp=100;effects=[];
    pendingSpecial=null;tailGrow=null;activeHoldTail=null;activeMashTail=null;
    approachTracker.lastY=ball.y;approachTracker.isDescending=false;
    gTimeEventIdx=0;gPatternQueue=null;gBallState='normal';
    uiUpdateHealth(hp);uiUpdateScoreAndCombo(score,combo);
    initTestBricks();resetBallState();
    let ro=document.querySelector('.result-overlay');if(ro)ro.classList.remove('show');
    if(gameBgmAudio&&gameBgmAudio.src){gameBgmAudio.currentTime=0;gameBgmAudio.play().catch(()=>{});}
    if(gameAnimId)cancelAnimationFrame(gameAnimId);
    gameAnimId=requestAnimationFrame(render);
}

function goToNext(){
    document.activeElement.blur(); 
    isPaused = false;
    let ca=document.getElementById('clearAudio');if(ca){ca.pause();ca.currentTime=0;}
    if(gameBgmAudio){gameBgmAudio.pause();gameBgmAudio.currentTime=0;gameBgmAudio.src='';gameBgmAudio.load();}
    if(_currentDiff.toLowerCase() === 'hard') return;

    let si = songs.findIndex(s=>s.id===_currentSongId);
    let song = songs[si];
    let diffs = song.difficulties.map(d=>d.toLowerCase());
    let di = diffs.indexOf(_currentDiff.toLowerCase());
    let nextSongIdx = si;
    let nextDiffIdx = di + 1;
    if(nextDiffIdx >= diffs.length) return; 

    selectedSong = nextSongIdx;
    selectedDiff = nextDiffIdx;
    let nextSong = songs[nextSongIdx];
    let nextDiff = nextSong.difficulties[nextDiffIdx].toLowerCase();

    let ro=document.querySelector('.result-overlay');if(ro)ro.classList.remove('show');
    document.removeEventListener('keydown',_gameKeyDown);
    document.removeEventListener('keyup',_gameKeyUp);
    initGame(nextSong.id, nextDiff);
}

function goToSelect(){
    document.activeElement.blur();
    isResultShowing = false;
    isPaused = false;
    let ca=document.getElementById('clearAudio');if(ca){ca.pause();ca.currentTime=0;}
    if(gameAnimId){cancelAnimationFrame(gameAnimId);gameAnimId=null;}
    if(gameBgmAudio){gameBgmAudio.pause();gameBgmAudio.currentTime=0;gameBgmAudio.onended=null;}
    document.removeEventListener('keydown',_gameKeyDown);
    document.removeEventListener('keyup',_gameKeyUp);
    let ro=document.querySelector('.result-overlay');if(ro)ro.classList.remove('show');
    let bf=document.getElementById('gameBgFilter');if(bf)bf.style.display='none';
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('songSelect').classList.add('active');
    renderSongList();
}

function goToLobby(){
    document.activeElement.blur();
    isResultShowing = false;
    isPaused = false;
    let ca=document.getElementById('clearAudio');if(ca){ca.pause();ca.currentTime=0;}
    if(gameAnimId){cancelAnimationFrame(gameAnimId);gameAnimId=null;}
    if(gameBgmAudio){gameBgmAudio.pause();gameBgmAudio.currentTime=0;gameBgmAudio.onended=null;}
    document.removeEventListener('keydown',_gameKeyDown);
    document.removeEventListener('keyup',_gameKeyUp);
    let ro=document.querySelector('.result-overlay');if(ro)ro.classList.remove('show');
    let bf=document.getElementById('gameBgFilter');if(bf)bf.style.display='none';
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('mainMenu').classList.add('active');
    let lobby=document.getElementById('bgmLobby');
    if(lobby){lobby.pause();lobby.currentTime=0;lobby.volume=bgmVolume;lobby.play().catch(()=>{});}
}

// -------------------------------------------------------
// [게임] 입력 리스너
// -------------------------------------------------------
function _gameKeyDown(e){
    if(e.repeat)return;
    let _ro=document.querySelector(".result-overlay"); if(_ro&&_ro.classList.contains("show"))return; 
    
    // 일시정지 키 (ESC) 추가
    if(e.code==='Escape'){
        e.preventDefault();
        if(hp <= 0 || isResultShowing) return; // 체력이 0이거나 결과 화면이면 일시정지 무시
        togglePause();
        return;
    }

    if (isPaused) return; // 일시정지 중 조작 무시

    if(e.code==='ArrowLeft')keyLeft=true;
    if(e.code==='ArrowRight')keyRight=true;
    if(e.code==='Space'||e.code==='ArrowUp'){
        keyPaddleHeld=true;uiSetPaddleActive(true);
        if(ball.attached){launchBallFromPaddle();return;}
        if(tryMashMarkerHit())return;
        if(ball.speedY>0&&!ball.heldOnPaddle){
            let dist=JUDGE_LINE_Y-ball.y;
            if(dist>GOOD_WINDOW&&dist<=200){processJudgement('miss');return;}
        }
        if(ball.speedY>0&&Math.abs(ball.y-JUDGE_LINE_Y)<=GOOD_WINDOW){
            if(ball.x>=paddle.x&&ball.x<=paddle.x+paddle.width){
                if(ball.type==='fake')return;
                let diff=Math.abs(ball.y-JUDGE_LINE_Y);
                let judge=diff<=PERFECT_WINDOW?'perfect':'good';
                uiHitParticle(ball.x,JUDGE_LINE_Y);processJudgement(judge);
                if(ball.type==='normal')bounceBall();
                else if(ball.type==='hold'){startHoldTailFromBall();captureBallToPaddle();}
                else if(ball.type==='mash'){startMashTailFromBall();captureBallToPaddle();}
            }
        }
    }
}
function _gameKeyUp(e){
    if (isPaused) return; // 일시정지 중 조작 무시
    if(e.code==='ArrowLeft')keyLeft=false;
    if(e.code==='ArrowRight')keyRight=false;
    if(e.code==='Space'||e.code==='ArrowUp'){keyPaddleHeld=false;uiSetPaddleActive(false);tryHoldTailRelease();}
}

// -------------------------------------------------------
// [게임] initGame 
// -------------------------------------------------------
let gTimeEvents = [], gTimeEventIdx = 0, gPatternQueue = null;
let gBallState = 'normal'; 
let gLongEndTime = 0, gMashEndTime = 0;

function initGame(songId, diff, onExitCb){
    _currentSongId=songId; _currentDiff=diff;
    if(onExitCb) _onExitCallback=onExitCb;
    window.gameOnSpecialBrickHit=gameOnSpecialBrickHit;

    isPaused = false;
    let po = document.getElementById('pauseOverlay');
    if(po) po.classList.remove('show');

    canvas=document.querySelector('.canvas');
    context=canvas.getContext('2d');
    healthFill=document.querySelector('.hp-gauge-fill');
    healthSlot=document.querySelector('.hp-guage-slot');
    playScreen=document.querySelector('.play-screen');
    scoreBox=document.querySelector('.score-box');
    comboBox=document.querySelector('.combo-box');
    judgementDisplay=document.querySelector('.judgement-text');

    let covers={'spyout2':'spyout2.jpg','badapple':'badapple.jpg','loveofthemoon':'loveofthemoon.png'};
    let bgFilter=document.getElementById('gameBgFilter');
    if(bgFilter&&covers[songId]){
        bgFilter.style.backgroundImage='url('+covers[songId]+')';
        bgFilter.style.display='block';
    } else if(bgFilter) {
        bgFilter.style.display='none';
    }

    score=0;combo=0;hp=100;maxCombo=0;totalNotes=0;hitNotes=0;effects=[];
    keyLeft=false;keyRight=false;keyPaddleHeld=false;
    pendingSpecial=null;tailGrow=null;activeHoldTail=null;activeMashTail=null;
    approachTracker.lastY=ball.y; approachTracker.isDescending=false;
    gTimeEvents=[];gTimeEventIdx=0;gPatternQueue=null;gBallState='normal';
    window.STAGE_DATA=null;

    paddle.width=diff==='easy'?160:diff==='hard'?90:140;
    paddle.x=canvas.width/2-paddle.width/2;
    paddle.isPressed=false;

    gameBgmAudio=document.getElementById('gameBgm');
    let songFiles={'spyout2':'spyout2.mp3','badapple':'badapple.mp3','loveofthemoon':'loveofthemoon.mp3'};
    if(gameBgmAudio&&songFiles[songId]){
        gameBgmAudio.pause();
        gameBgmAudio.currentTime=0;
        gameBgmAudio.src=songFiles[songId];
        gameBgmAudio.load();
        gameBgmAudio.volume=parseFloat(localStorage.getItem('bgmVolume')||'40')/100;
    }

    let stageEl=document.getElementById('stageBox');
    if(stageEl){
        let stageNum={'easy':'01','normal':'02','hard':'03'};
        stageEl.textContent=stageNum[diff]||'01';
    }

    document.addEventListener('keydown',_gameKeyDown);
    document.addEventListener('keyup',_gameKeyUp);

    let oldScript=document.getElementById('stageScript');
    if(oldScript)oldScript.remove();
    let sc=document.createElement('script');
    sc.id='stageScript';
    sc.src='stages/'+songId+'_'+diff+'.js';
    sc.onload=function(){
        if(window.STAGE_DATA){
            if(window.STAGE_DATA.speed) paddle.x=canvas.width/2-paddle.width/2; 
            gTimeEvents=window.STAGE_DATA.events||[];
        }
        gTimeEventIdx=0;
        initTestBricks();
        resetBallState();
        uiUpdateHealth(hp);
        uiUpdateScoreAndCombo(score,combo);
        if(gameBgmAudio&&gameBgmAudio.src){
            gameBgmAudio.play().catch(()=>{});
        }
        if(gameAnimId)cancelAnimationFrame(gameAnimId);
        gameAnimId=requestAnimationFrame(render);
    };
    sc.onerror=function(){
        gTimeEvents=[];gTimeEventIdx=0;
        initTestBricks();
        resetBallState();
        uiUpdateHealth(hp);
        uiUpdateScoreAndCombo(score,combo);
        if(gameBgmAudio&&gameBgmAudio.src){
            gameBgmAudio.play().catch(()=>{});
        }
        if(gameAnimId)cancelAnimationFrame(gameAnimId);
        gameAnimId=requestAnimationFrame(render);
    };
    document.head.appendChild(sc);
}

// =======================================================
// [로비] op.html 로비 시스템
// =======================================================
const startScreen=()=>document.getElementById('startScreen');
const mainMenu=()=>document.getElementById('mainMenu');

let currentIndex=0;
const slideCount=3;
let bgmVolume=parseFloat(localStorage.getItem('bgmVolume')||'40')/100;
let sfxVolume=parseFloat(localStorage.getItem('sfxVolume')||'80')/100;

function setBgmVolume(v){
    bgmVolume=v/100;
    let b=document.getElementById('bgmLobby');if(b)b.volume=bgmVolume;
    let b2=document.getElementById('bgmSelect');if(b2)b2.volume=bgmVolume;
    if(gameBgmAudio) gameBgmAudio.volume = bgmVolume; // 게임 중 볼륨 즉시 반영
    localStorage.setItem('bgmVolume',v);
    
    // UI 슬라이더 동기화
    let mainVol = document.getElementById('volBgm'); if(mainVol && mainVol.value !== v) mainVol.value = v;
    let pVol = document.getElementById('pauseVolBgm'); if(pVol && pVol.value !== v) pVol.value = v;
}

function setSfxVolume(v){
    sfxVolume=v/100;
    localStorage.setItem('sfxVolume',v);
    
    // UI 슬라이더 동기화
    let mainVol = document.getElementById('volSfx'); if(mainVol && mainVol.value !== v) mainVol.value = v;
    let pVol = document.getElementById('pauseVolSfx'); if(pVol && pVol.value !== v) pVol.value = v;
}

function setBrightness(v){document.body.style.filter='brightness('+(v/100)+')';localStorage.setItem('brightness',v);}
function setTimingGuide(on){localStorage.setItem('timingGuide',on);let g1=document.getElementById('guideOn'),g2=document.getElementById('guideOff');if(g1)g1.classList.toggle('active',on);if(g2)g2.classList.toggle('active',!on);}
function setPaddleSpeed(v){v=parseInt(v);localStorage.setItem('paddleSpeed',v);let el=document.getElementById('paddleSpeedVal');if(el)el.textContent=v;}
function gAdjustSpeed(d){let spd=parseFloat(localStorage.getItem('ballSpeed')||'2');spd=Math.max(1,Math.min(12,+(spd+d).toFixed(1)));localStorage.setItem('ballSpeed',spd);}

function setTheme(name){
    document.documentElement.setAttribute('data-theme',name);localStorage.setItem('theme',name);
    let sel=document.getElementById('themeSelect');if(sel)sel.value=name;
    let crt=document.querySelector('.crt-overlay');if(crt)crt.style.display=(name==='classic')?'none':'';
    let cl=document.getElementById('classicThemeCSS');
    if(name==='classic'){if(!cl){cl=document.createElement('link');cl.id='classicThemeCSS';cl.rel='stylesheet';cl.href='index (1)/style.css';document.head.appendChild(cl);}}
    else{if(cl)cl.remove();}
}

function playShift(){let s=document.getElementById('sfxShift');if(s){s.volume=sfxVolume;s.currentTime=0;s.play().catch(()=>{});}}

function updateSlide(){
    let sc=document.getElementById('slideContainer');
    if(sc)sc.style.transform='translateX(-'+(currentIndex*(100/slideCount))+'%)';
}
function slideLeftFn(){currentIndex=(currentIndex-1+slideCount)%slideCount;updateSlide();playShift();}
function slideRightFn(){currentIndex=(currentIndex+1)%slideCount;updateSlide();playShift();}

function goToMainMenu(){
    let ss=document.getElementById('startScreen');
    ss.classList.add('hidden');
    setTimeout(()=>{
        ss.style.display='none';
        document.getElementById('mainMenu').classList.add('active');
        let b=document.getElementById('bgmLobby');if(b){b.volume=bgmVolume;b.play().catch(()=>{});}
    },600);
}

function activateCurrentSlide(){
    if(currentIndex===0)openSongSelect();
    else if(currentIndex===1){let sm=document.getElementById('storyModal');if(sm)sm.classList.add('active');}
    else if(currentIndex===2){let os=document.getElementById('optionScreen');if(os)os.classList.add('active');}
}

let startHandled=false;
function handleStart(){
    if(startHandled)return;
    startHandled=true;
    goToMainMenu();
    document.addEventListener('keydown',handleMenuKeys);
}

function handleMenuKeys(e){
    if(document.getElementById('gameScreen').classList.contains('active'))return;
    let sm=document.getElementById('storyModal'),os=document.getElementById('optionScreen'),ss2=document.getElementById('songSelect');
    if(sm&&sm.classList.contains('active')){if(e.key==='Escape')sm.classList.remove('active');return;}
    if(os&&os.classList.contains('active')){if(e.key==='Escape')os.classList.remove('active');return;}
    if(ss2&&ss2.classList.contains('active')){
        if(e.key==='Escape'){closeSongSelect();return;}
        if(e.key==='ArrowUp'){selectedSong=(selectedSong-1+songs.length)%songs.length;selectedDiff=0;renderSongList();playShift();return;}
        if(e.key==='ArrowDown'){selectedSong=(selectedSong+1)%songs.length;selectedDiff=0;renderSongList();playShift();return;}
        if(e.key==='ArrowLeft'){let d=songs[selectedSong].difficulties;selectedDiff=(selectedDiff-1+d.length)%d.length;updateDiffDisplay();playShift();return;}
        if(e.key==='ArrowRight'){let d=songs[selectedSong].difficulties;selectedDiff=(selectedDiff+1)%d.length;updateDiffDisplay();playShift();return;}
        if(e.key==='Enter'){startGame();return;}
        return;
    }
    if(e.key==='ArrowLeft')slideLeftFn();
    else if(e.key==='ArrowRight')slideRightFn();
    else if(e.key==='Enter')activateCurrentSlide();
}

let songs=[
    {title:'Bad Apple!!',id:'badapple',sub:'東方PROJECT',difficulties:['EASY','NORMAL','HARD'],music:'badapple.mp3',cover:'badapple.jpg',previewStart:57,previewEnd:70},
    {title:'SPY OUT2',id:'spyout2',sub:'SHK ENT',difficulties:['EASY','NORMAL','HARD'],music:'spyout2.mp3',cover:'spyout2.jpg',previewStart:35,previewEnd:50},
    {title:'月哀 (월애)',id:'loveofthemoon',sub:'SHK ENT',difficulties:['EASY','NORMAL','HARD'],music:'loveofthemoon.mp3',cover:'loveofthemoon.png',previewStart:10,previewEnd:25}
];
let selectedSong=0,selectedDiff=0;
let previewAudio=null;

function startPreview(){
    stopPreview();
    let song=songs[selectedSong];if(!song.music)return;
    previewAudio=new Audio(song.music);
    previewAudio.volume=0;previewAudio.currentTime=song.previewStart;previewAudio.play().catch(()=>{});
    let fi=setInterval(()=>{
        if(!previewAudio){clearInterval(fi);return;}
        if(previewAudio.volume<bgmVolume-0.04)previewAudio.volume+=0.04;
        else{previewAudio.volume=bgmVolume;clearInterval(fi);}
    },30);
    function onTU(){
        if(!previewAudio)return;
        if(previewAudio.currentTime>=song.previewEnd-0.8){
            previewAudio.removeEventListener('timeupdate',onTU);
            let fo=setInterval(()=>{
                if(!previewAudio){clearInterval(fo);return;}
                if(previewAudio.volume>0.04)previewAudio.volume-=0.04;
                else{previewAudio.pause();clearInterval(fo);
                    setTimeout(()=>{
                        if(!previewAudio)return;
                        previewAudio.currentTime=song.previewStart;previewAudio.volume=0;previewAudio.play().catch(()=>{});
                        let fi2=setInterval(()=>{if(!previewAudio){clearInterval(fi2);return;}if(previewAudio.volume<bgmVolume-0.04)previewAudio.volume+=0.04;else{previewAudio.volume=bgmVolume;clearInterval(fi2);}},30);
                        previewAudio.addEventListener('timeupdate',onTU);
                    },400);
                }
            },30);
        }
    }
    previewAudio.addEventListener('timeupdate',onTU);
}
function stopPreview(){if(previewAudio){previewAudio.pause();previewAudio=null;}}

function renderSongList(){
    let sl=document.getElementById('ssList');if(!sl)return;
    sl.innerHTML='';
    for(let i=0;i<songs.length;i++){
        let item=document.createElement('div');
        item.className='ss-song-item'+(i===selectedSong?' selected':'');
        let thumb=songs[i].cover?'background-image:url('+songs[i].cover+');background-size:cover;background-position:center;':'';
        item.innerHTML='<div class="ss-song-thumb" style="'+thumb+'"></div><div class="ss-song-info"><div class="ss-song-title">'+songs[i].title+'</div><div class="ss-song-sub">'+songs[i].sub+'</div></div>';
        item.setAttribute('data-idx',i);
        item.addEventListener('click',function(){
            let idx=parseInt(this.getAttribute('data-idx'));
            if(idx===selectedSong){startGame();return;}
            selectedSong=idx;selectedDiff=0;renderSongList();updateDiffDisplay();
        });
        sl.appendChild(item);
    }
    let song=songs[selectedSong];
    let sa=document.getElementById('ssAlbum');
    if(sa&&song.cover){sa.style.backgroundImage='url('+song.cover+')';sa.style.backgroundSize='cover';sa.style.backgroundPosition='center';}
    updateDiffDisplay();
    startPreview();
}

function updateDiffDisplay(){
    let diffs=songs[selectedSong].difficulties;
    if(selectedDiff>=diffs.length)selectedDiff=0;
    let d=diffs[selectedDiff];
    let dt=document.getElementById('diffText');if(dt){dt.textContent=d;dt.className='ss-diff-text '+d.toLowerCase();}
    let songId=songs[selectedSong].id;
    let key='best_'+songId+'_'+d.toLowerCase();
    let best=JSON.parse(localStorage.getItem(key)||'{"score":0,"combo":0}');
    let bs=document.getElementById('ssBestScore');if(bs)bs.textContent=best.score;
    let bc=document.getElementById('ssBestCombo');if(bc)bc.textContent=best.combo;
}

function openSongSelect(){
    playEntryAnimation(()=>{
        document.getElementById('songSelect').classList.add('active');
        let b=document.getElementById('bgmLobby');if(b)b.pause();
        renderSongList();
    });
}
function closeSongSelect(){
    stopPreview();
    document.getElementById('songSelect').classList.remove('active');
    let bs=document.getElementById('bgmSelect');if(bs)bs.pause();
    document.getElementById('mainMenu').classList.add('active');
    let b=document.getElementById('bgmLobby');if(b){b.volume=bgmVolume;b.play().catch(()=>{});}
    window.location.hash='';
}

function startGame(){
    stopPreview();
    let song=songs[selectedSong];
    let diff=song.difficulties[selectedDiff].toLowerCase();
    let sel=document.querySelector('.ss-song-item.selected');
    if(sel){sel.style.transition='background 0.2s,box-shadow 0.2s';sel.style.background='rgba(0,255,255,0.3)';sel.style.boxShadow='0 0 30px rgba(0,255,255,0.6)';}
    setTimeout(()=>{
        document.getElementById('songSelect').classList.remove('active');
        let b=document.getElementById('bgmLobby');if(b)b.pause();
        document.getElementById('gameScreen').classList.add('active');
        initGame(song.id,diff);
    },400);
}

let entryAnim=null,entryCanvas2=null,entryCount2=null,entryCtx2=null;
function playEntryAnimation(callback){
    let btnPlay=document.getElementById('btnPlay');
    if(!btnPlay){if(callback)callback();return;}
    let btnRect=btnPlay.getBoundingClientRect();
    let cx=btnRect.left+btnRect.width/2,cy=btnRect.top+btnRect.height/2,ringRadius=btnRect.width/2-10;
    entryAnim=document.getElementById('entryAnim');
    entryCanvas2=document.getElementById('entryCanvas');
    entryCount2=document.getElementById('entryCount');
    entryCtx2=entryCanvas2.getContext('2d');
    entryAnim.classList.add('active');
    entryCanvas2.width=window.innerWidth;entryCanvas2.height=window.innerHeight;
    let phase=0,phaseTimer=0,sweepAngle=0,currentRadius=ringRadius,animId=null,framesPerSweep=45;
    let bs2=document.getElementById('bgmSelect');if(bs2){bs2.volume=bgmVolume;bs2.currentTime=0;bs2.play().catch(()=>{});}
    let bL=document.getElementById('bgmLobby');
    if(bL){let fi=setInterval(()=>{if(bL.volume>0.02)bL.volume=Math.max(0,bL.volume-0.02);else{bL.pause();bL.volume=0;clearInterval(fi);}},50);}
    entryCount2.textContent='';entryCount2.style.left=cx+'px';entryCount2.style.top=cy+'px';entryCount2.className='entry-count';
    function drawEntry(){
        entryCtx2.clearRect(0,0,entryCanvas2.width,entryCanvas2.height);
        phaseTimer++;
        if(phase===0&&phaseTimer>=15){phase=1;phaseTimer=0;sweepAngle=0;entryCount2.textContent='READY';entryCount2.className='entry-count pulse';}
        else if(phase===1&&phaseTimer>=framesPerSweep){phase=2;phaseTimer=0;entryCount2.textContent='GO!';entryCount2.className='entry-count pulse';}
        if(phase===2&&phaseTimer>=10){phase=3;phaseTimer=0;entryCount2.textContent='MUSIC SELECT';entryCount2.className='entry-count shrink';}
        if(phase===1)sweepAngle=(phaseTimer/framesPerSweep)*Math.PI*2;
        if(phase===2||phase===3)currentRadius+=(currentRadius*0.06)+8;
        let drawR=(phase===2||phase===3)?currentRadius:ringRadius;
        entryCtx2.beginPath();entryCtx2.arc(cx,cy,drawR,0,Math.PI*2);entryCtx2.fillStyle='rgba(0,0,0,0.85)';entryCtx2.fill();
        if(phase===1){entryCtx2.beginPath();entryCtx2.arc(cx,cy,ringRadius,-Math.PI/2,-Math.PI/2+sweepAngle);entryCtx2.lineWidth=6;entryCtx2.strokeStyle='#ffffff';entryCtx2.shadowBlur=12;entryCtx2.shadowColor='rgba(255,255,255,0.8)';entryCtx2.stroke();entryCtx2.shadowBlur=0;}
        if(phase===2||phase===3){entryCtx2.beginPath();entryCtx2.arc(cx,cy,currentRadius,0,Math.PI*2);entryCtx2.lineWidth=8;entryCtx2.strokeStyle='rgba(255,255,255,'+Math.max(0,1-phaseTimer*0.03)+')';entryCtx2.stroke();}
        let maxDim=Math.max(entryCanvas2.width,entryCanvas2.height)*1.5;
        if((phase===2||phase===3)&&currentRadius>=maxDim){cancelAnimationFrame(animId);entryAnim.classList.remove('active');if(callback)callback();return;}
        animId=requestAnimationFrame(drawEntry);
    }
    drawEntry();
}

(function(){
    let t=localStorage.getItem('theme')||'cyber';setTheme(t);
    let ps=localStorage.getItem('paddleSpeed');
    if(ps){let v=parseInt(ps);let el=document.getElementById('volPaddle');if(el)el.value=v;let el2=document.getElementById('paddleSpeedVal');if(el2)el2.textContent=v;}
})();

document.addEventListener('DOMContentLoaded',()=>{
    const songIds = ['badapple','spyout2','loveofthemoon'];
    const diffs = ['easy','normal','hard'];
    songIds.forEach(id => diffs.forEach(d => localStorage.removeItem('best_'+id+'_'+d)));

    let ss=document.getElementById('startScreen');
    let navL=document.getElementById('navLeft'),navR=document.getElementById('navRight');
    let btnPlay=document.getElementById('btnPlay'),btnStory=document.getElementById('btnStory'),btnOption=document.getElementById('btnOption');
    let storyModal=document.getElementById('storyModal'),storyClose=document.getElementById('storyClose');
    let optionScreen=document.getElementById('optionScreen'),optionBack=document.getElementById('optionBack');
    let diffL=document.getElementById('diffLeft'),diffR=document.getElementById('diffRight');

    document.addEventListener('keydown',e=>{if(!startHandled)handleStart();});
    if(ss)ss.addEventListener('click',handleStart);
    if(navL)navL.addEventListener('click',slideLeftFn);
    if(navR)navR.addEventListener('click',slideRightFn);
    if(btnPlay)btnPlay.addEventListener('click',openSongSelect);
    if(btnStory)btnStory.addEventListener('click',()=>{if(storyModal)storyModal.classList.add('active');});
    if(btnOption)btnOption.addEventListener('click',()=>{if(optionScreen)optionScreen.classList.add('active');});
    if(storyClose)storyClose.addEventListener('click',()=>{if(storyModal)storyModal.classList.remove('active');});
    if(optionBack)optionBack.addEventListener('click',()=>{if(optionScreen)optionScreen.classList.remove('active');});
    if(diffL)diffL.addEventListener('click',()=>{let d=songs[selectedSong].difficulties;selectedDiff=(selectedDiff-1+d.length)%d.length;updateDiffDisplay();playShift();});
    if(diffR)diffR.addEventListener('click',()=>{let d=songs[selectedSong].difficulties;selectedDiff=(selectedDiff+1)%d.length;updateDiffDisplay();playShift();});

    // 일시정지 오버레이 버튼 이벤트 연결
    let btnResume = document.getElementById('btnResume');
    if(btnResume) btnResume.addEventListener('click', togglePause);
    
    let btnRestart = document.getElementById('btnRestart');
    if(btnRestart) btnRestart.addEventListener('click', () => {
        togglePause();
        retryGame();
    });
    
    let btnExitSong = document.getElementById('btnExitSong');
    if(btnExitSong) btnExitSong.addEventListener('click', () => {
        if(isPaused) togglePause(); 
        goToSelect();
    });
    
    let btnExitLobby = document.getElementById('btnExitLobby');
    if(btnExitLobby) btnExitLobby.addEventListener('click', () => {
        if(isPaused) togglePause();
        goToLobby();
    });

    let pVolBgm = document.getElementById('pauseVolBgm');
    if(pVolBgm) pVolBgm.addEventListener('input', (e) => setBgmVolume(e.target.value));

    let pVolSfx = document.getElementById('pauseVolSfx');
    if(pVolSfx) pVolSfx.addEventListener('input', (e) => setSfxVolume(e.target.value));

    let ringCanvases=document.querySelectorAll('.circle-btn canvas');
    let ringTime=0;
    function drawRings(){
        ringTime+=0.01;
        ringCanvases.forEach((cv,idx)=>{
            let c=cv.getContext('2d'),w=cv.width,h=cv.height,cx2=w/2,cy2=h/2,r=160;
            c.clearRect(0,0,w,h);
            let h1=(ringTime*60+idx*120)%360,h2=(h1+90)%360,h3=(h1+180)%360;
            let grad=c.createConicGradient(ringTime*2+idx,cx2,cy2);
            grad.addColorStop(0,'hsl('+h1+',100%,65%)');grad.addColorStop(0.33,'hsl('+h2+',100%,65%)');
            grad.addColorStop(0.66,'hsl('+h3+',100%,65%)');grad.addColorStop(1,'hsl('+h1+',100%,65%)');
            c.beginPath();c.arc(cx2,cy2,r,0,Math.PI*2);c.lineWidth=6;c.strokeStyle=grad;
            c.shadowBlur=15;c.shadowColor='hsl('+h1+',100%,60%)';c.stroke();c.shadowBlur=0;
        });
        requestAnimationFrame(drawRings);
    }
    drawRings();
    updateSlide();
    if(window.location.hash==='#musicselect'){
        startHandled=true;
        let ss2=document.getElementById('startScreen');if(ss2)ss2.style.display='none';
        let songSel=document.getElementById('songSelect');if(songSel)songSel.classList.add('active');
        document.addEventListener('keydown',handleMenuKeys);
        renderSongList();
        let bL2=document.getElementById('bgmLobby');if(bL2){bL2.volume=bgmVolume*0.25;bL2.play().catch(()=>{});}
    }
});
