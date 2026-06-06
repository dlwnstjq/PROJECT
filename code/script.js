// ==========================================
// [1] 전역 게임 상태 및 설정 상수
// ==========================================
let canvas, context;
let healthFill, healthSlot, playScreen, scoreBox, comboBox, judgementDisplay;

let score = 0;
let combo = 0;
let hp = 100;

const ball = {
    x: 250, y: 480, radius: 8,
    type: 'normal', tailLength: 0, specialLocked: false,
    speedX: 0, speedY: 0, 
    attached: true, 
    heldOnPaddle: false,  
    paddleOffsetX: 0,     
    earlyMissed: false
};

const paddle = { x: 180, y: 520, width: 140, height: 12, isPressed: false };
let bricks = [];
let effects = []; 

// 리듬 게임 판정 상수
const JUDGE_LINE_Y = 520;
const PERFECT_WINDOW = 16;
const GOOD_WINDOW = 32;
const EFFECT_SPAWN_Y = 280;
const MAX_RADIUS = 45;

// 게임 밸런스 상수
const NORMAL_MISS_HP = 20;
const MASH_MISS_HP = 12;
const MASH_MARKER_COUNT = 3;
const TAIL_EXTRUDE_SPEED = 6;
const BRICK_W = 52;
const BRICK_H = 22;
const BRICK_GAP = 6;
const BRICK_ROW_Y = 100;

// 입력 및 내부 타이머 상태
let keyLeft = false;
let keyRight = false;
let keyPaddleHeld = false;

let pendingSpecial = null;
let tailGrow = null;
let activeHoldTail = null;
let activeMashTail = null;

let judgeTimer = null; 
let comboTimer = null;
let damageTimer = null;

const approachTracker = { lastY: ball.y, isDescending: false };

// ==========================================
// [2] 함수 정의
// ==========================================

const initTestBricks = () => {
    const types = ['normal', 'hold', 'mash', 'normal'];
    const tailByType = { hold: 140, mash: 150 };
    const count = types.length;
    
    const totalW = count * BRICK_W + (count - 1) * BRICK_GAP;
    let startX = ((canvas ? canvas.width : 500) - totalW) / 2;

    bricks = [];
    for (let i = 0; i < types.length; i++) {
        let currentType = types[i];
        let tLen = 0;
        if (currentType === 'hold') tLen = tailByType.hold;
        else if (currentType === 'mash') tLen = tailByType.mash;

        bricks.push({
            x: startX + i * (BRICK_W + BRICK_GAP),
            y: BRICK_ROW_Y,
            w: BRICK_W,
            h: BRICK_H,
            type: currentType,
            tailLength: tLen,
            alive: true
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
        healthSlot.style.borderColor = "#ff0055"; 
        playScreen.style.borderColor = "#ff0055"; 
        playScreen.style.boxShadow = "inset 0 0 60px rgba(255, 0, 85, 0.25)";
    } else {
        healthFill.style.background = "linear-gradient(#00ffff 0%, #0088ff 100%)";
        healthFill.style.boxShadow = "0 0 20px #00ffff, inset 0 0 10px #ffffff";
        healthSlot.style.borderColor = "#00ffff"; 
        playScreen.style.borderColor = "#00ffff"; 
        playScreen.style.boxShadow = "inset 0 0 40px rgba(0, 255, 255, 0.15)";
    }
};

const uiUpdateScoreAndCombo = (scoreValue, comboValue) => {
    score = scoreValue;
    combo = comboValue;
    let scoreStr = score.toString();
    while (scoreStr.length < 6) {
        scoreStr = '0' + scoreStr;
    }
    scoreBox.textContent = scoreStr;
    
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
    healthFill.style.background = "#ffffff";
    healthFill.style.boxShadow = "0 0 40px #ffffff, inset 0 0 20px #ffffff";
    damageTimer = setTimeout(() => { uiUpdateHealth(hp); }, 100);
};

const animJudge = (text, judgeType) => {
    judgementDisplay.textContent = text;
    judgementDisplay.classList.remove('judge-perfect', 'judge-good', 'judge-miss');
    judgementDisplay.classList.add(`judge-${judgeType}`);
    
    let frame = 0; const maxFrame = 25; 
    if (judgeTimer) clearInterval(judgeTimer);
    
    const targetSize = 55; 
    judgeTimer = setInterval(() => {
        frame++;
        if (frame <= 5) {
            let progress = frame / 5; 
            let startSize = targetSize + 12;
            judgementDisplay.style.opacity = 1; 
            judgementDisplay.style.top = "35%"; 
            judgementDisplay.style.fontSize = (startSize - (12 * progress)) + "px"; 
        } else if (frame <= maxFrame) {
            let progress = (frame - 5) / 20; 
            judgementDisplay.style.opacity = 1.0 - progress; 
            judgementDisplay.style.top = (35 - (5 * progress)) + "%"; 
            judgementDisplay.style.fontSize = (targetSize - (4 * progress)) + "px"; 
        } else {
            clearInterval(judgeTimer);
        }
    }, 16);
};

const animCombo = () => {
    const targetSize = 45;
    let currentSize = targetSize + 12;
    comboBox.style.color = "#ffffff";
    if (comboTimer) clearInterval(comboTimer);
    
    comboTimer = setInterval(() => {
        currentSize -= 2;
        if (currentSize <= targetSize) { 
            currentSize = targetSize;
            comboBox.style.color = "#ff00ff";
            clearInterval(comboTimer);
        }
        comboBox.style.fontSize = currentSize + "px";
    }, 16);
};

const uiShowJudgement = (judgeType) => {
    if (judgeType == 'miss') {
        animDamage();
        animJudge("MISS", "miss");
    } else if (judgeType == 'perfect') {
        animJudge("PERFECT", "perfect");
    } else if (judgeType == 'good') {
        animJudge("GOOD", "good");
    } else {
        animJudge(judgeType, "perfect");
    }
};

const uiHitParticle = (x, y) => {
    effects.push({ x: x, y: y, radius: 10, alpha: 1 });
};

const processJudgement = (type, options = {}) => {
    if (type === 'perfect') {
        score += 100 + (combo * 10);
        combo++;
        hp = Math.min(100, hp + 2);
    } else if (type === 'good') {
        score += 50;
        combo++;
        hp = Math.min(100, hp + 1);
    } else if (type === 'miss') {
        combo = 0;
        let dmg = options.light ? MASH_MISS_HP : NORMAL_MISS_HP;
        hp = Math.max(0, hp - dmg);
    }
    uiUpdateScoreAndCombo(score, combo);
    uiUpdateHealth(hp);
    uiShowJudgement(type);
};

const launchBallFromPaddle = () => {
    ball.attached = false;
    ball.heldOnPaddle = false;
    ball.earlyMissed = false;
    ball.x = paddle.x + paddle.width / 2;
    ball.y = paddle.y - ball.radius - 2;
    ball.speedX = 0;
    ball.speedY = -5;
};

const bounceBall = () => {
    ball.attached = false;
    ball.heldOnPaddle = false;
    ball.earlyMissed = false;
    ball.speedY = -4;
    let hitPoint = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
    ball.speedX = hitPoint * 4;
    ball.type = 'normal';
    ball.tailLength = 0;
    ball.specialLocked = false;
    tailGrow = null;
};

const dropHeldBall = () => {
    if (ball.heldOnPaddle) {
        ball.heldOnPaddle = false;
        ball.speedY = 3;
        ball.type = 'normal'; 
        ball.tailLength = 0;
        tailGrow = null;
    }
};

const getTravelDir = (vx, vy) => {
    let len = Math.sqrt(vx * vx + vy * vy);
    return len < 0.01 ? { x: 0, y: 1 } : { x: vx / len, y: vy / len };
};

const getTailBackDir = (vx, vy) => {
    let t = getTravelDir(vx, vy);
    return { x: -t.x, y: -t.y };
};

const tailBackPoint = (headX, headY, backX, backY, length) => {
    return { x: headX + backX * length, y: headY + backY * length };
};

const startHoldTailFromBall = () => {
    let tailLen = getBallTailDisplayLength() || ball.tailLength;
    let motion = captureTailMotion(ball.speedX, ball.speedY);
    let far = tailBackPoint(ball.x, ball.y, motion.backX, motion.backY, tailLen);
    activeHoldTail = {
        nearX: ball.x, nearY: ball.y, farX: far.x, farY: far.y,
        moveX: motion.moveX, moveY: motion.moveY, backX: motion.backX, backY: motion.backY,
        speed: motion.speed, missed: false, released: false, releaseWindow: false, absorbing: false
    };
};

const startMashTailFromBall = () => {
    let tailLen = getBallTailDisplayLength() || ball.tailLength;
    let motion = captureTailMotion(ball.speedX, ball.speedY);
    let spacing = tailLen / MASH_MARKER_COUNT;
    let markers = [];
    for (let i = 1; i <= MASH_MARKER_COUNT; i++) {
        let p = tailBackPoint(ball.x, ball.y, motion.backX, motion.backY, spacing * i);
        markers.push({ x: p.x, y: p.y, state: 'pending' });
    }
    activeMashTail = {
        anchorX: ball.x, anchorY: ball.y,
        moveX: motion.moveX, moveY: motion.moveY, backX: motion.backX, backY: motion.backY,
        speed: motion.speed, markers: markers
    };
};

const captureBallToPaddle = () => {
    ball.heldOnPaddle = true;
    ball.paddleOffsetX = ball.x - paddle.x;
    ball.y = JUDGE_LINE_Y - ball.radius;
    ball.speedX = 0; 
    ball.speedY = 0;
};

const getMashMarkerInWindow = () => {
    if (!activeMashTail) return null;

    let bestMarker = null;
    for (let i = 0; i < activeMashTail.markers.length; i++) {
        let m = activeMashTail.markers[i];
        if (m.state === 'pending' && m.x >= paddle.x && m.x <= paddle.x + paddle.width) {
            if (Math.abs(m.y - JUDGE_LINE_Y) <= GOOD_WINDOW) {
                if (bestMarker === null || m.y > bestMarker.y) {
                    bestMarker = m;
                }
            }
        }
    }
    return bestMarker;
};

const tryMashMarkerHit = () => {
    let targetMarker = getMashMarkerInWindow();
    if (!targetMarker) return false;

    let diff = Math.abs(targetMarker.y - JUDGE_LINE_Y);
    let judge = diff <= PERFECT_WINDOW ? 'perfect' : 'good';
    processJudgement(judge);
    uiHitParticle(targetMarker.x, JUDGE_LINE_Y);
    targetMarker.state = 'hit';
    return true;
};

const tryHoldTailRelease = () => {
    if (!activeHoldTail || activeHoldTail.missed || activeHoldTail.released) return;

    if (!activeHoldTail.releaseWindow) {
        processJudgement('miss');
        dropHeldBall(); 
        activeHoldTail = null; 
        return;
    }

    let diff = Math.abs(activeHoldTail.farY - JUDGE_LINE_Y);
    let judge = diff <= PERFECT_WINDOW ? 'perfect' : diff <= GOOD_WINDOW ? 'good' : 'miss';
    processJudgement(judge);
    
    if (judge !== 'miss') {
        uiHitParticle(activeHoldTail.farX, JUDGE_LINE_Y);
        if (ball.heldOnPaddle) bounceBall();
    } else {
        dropHeldBall(); 
    }
    activeHoldTail = null; 
};

const tryHoldTailReleaseOnOutsideMiss = () => {
    processJudgement('miss');
    dropHeldBall();
    activeHoldTail = null;
};

const initInputListeners = () => {
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return; 

        if (e.code === 'ArrowLeft') keyLeft = true;
        if (e.code === 'ArrowRight') keyRight = true;
        
        if (e.code === 'Space' || e.code === 'ArrowUp') {
            keyPaddleHeld = true;
            uiSetPaddleActive(true);
            
            if (ball.attached) {
                launchBallFromPaddle();
                return;
            }

            if (tryMashMarkerHit()) return;

            if (ball.speedY > 0 && !ball.heldOnPaddle) {
                let dist = JUDGE_LINE_Y - ball.y;
                if (dist > GOOD_WINDOW && dist <= 200) {
                    processJudgement('miss');
                    return; 
                }
            }

            if (ball.speedY > 0 && Math.abs(ball.y - JUDGE_LINE_Y) <= GOOD_WINDOW) {
                if (ball.x >= paddle.x && ball.x <= paddle.x + paddle.width) {
                    if (ball.type === 'fake') return;

                    let diff = Math.abs(ball.y - JUDGE_LINE_Y);
                    let judge = diff <= PERFECT_WINDOW ? 'perfect' : 'good';

                    uiHitParticle(ball.x, JUDGE_LINE_Y);
                    processJudgement(judge);

                    if (ball.type === 'normal') {
                        bounceBall();
                    } else if (ball.type === 'hold') {
                        startHoldTailFromBall();
                        captureBallToPaddle();
                    } else if (ball.type === 'mash') {
                        startMashTailFromBall();
                        captureBallToPaddle();
                    }
                }
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'ArrowLeft') keyLeft = false;
        if (e.code === 'ArrowRight') keyRight = false;
        if (e.code === 'Space' || e.code === 'ArrowUp') {
            keyPaddleHeld = false;
            uiSetPaddleActive(false);
            tryHoldTailRelease();
        }
    });
};

const syncTailGrowDirection = () => {
    if (!tailGrow || ball.attached || ball.heldOnPaddle) return;
    let back = getTailBackDir(ball.speedX, ball.speedY);
    tailGrow.dirX = back.x;
    tailGrow.dirY = back.y;
};

const isSpecialStateBusy = () => {
    return ball.specialLocked || pendingSpecial || activeHoldTail || activeMashTail;
};

const gameOnSpecialBrickHit = (type, tailLength = 160) => {
    if (type !== 'hold' && type !== 'mash') return false;
    if (isSpecialStateBusy()) return false;
    pendingSpecial = { type: type, tailLength: tailLength };
    return true;
};

const queueSpecialNote = (type, tailLength) => {
    if (isSpecialStateBusy()) return;
    pendingSpecial = { type: type, tailLength: tailLength };
};

const activatePendingSpecial = () => {
    if (!pendingSpecial || ball.y < EFFECT_SPAWN_Y) return;

    ball.type = pendingSpecial.type;
    ball.tailLength = pendingSpecial.tailLength;
    ball.specialLocked = true;
    let back = getTailBackDir(ball.speedX, ball.speedY);
    tailGrow = {
        length: pendingSpecial.tailLength,
        current: 0,
        dirX: back.x, dirY: back.y,
        originX: ball.x, originY: ball.y
    };
    pendingSpecial = null;
};

const getBallTailDisplayLength = () => {
    if (ball.heldOnPaddle) return 0; 
    if (tailGrow) return tailGrow.current;
    if (ball.type === 'hold' || ball.type === 'mash') return ball.tailLength;
    return 0;
};

const updateTailGrow = () => {
    if (!tailGrow || tailGrow.current >= tailGrow.length) return;
    syncTailGrowDirection();
    tailGrow.current = Math.min(tailGrow.length, tailGrow.current + TAIL_EXTRUDE_SPEED);
};

const captureTailMotion = (vx, vy) => {
    let travel = getTravelDir(vx, vy);
    let back = getTailBackDir(vx, vy);
    let speed = Math.sqrt(vx * vx + vy * vy) || 3;
    return { moveX: travel.x, moveY: travel.y, backX: back.x, backY: back.y, speed: speed };
};

const resetBallState = () => {
    ball.attached = true;
    ball.heldOnPaddle = false;
    ball.earlyMissed = false;
    ball.speedX = 0; ball.speedY = 0;
    ball.type = 'normal';
    ball.tailLength = 0;
    ball.specialLocked = false;
    tailGrow = null;
    pendingSpecial = null;
    activeHoldTail = null;
    activeMashTail = null;
};

const checkBallBrickCollisions = () => {
    for (let i = 0; i < bricks.length; i++) {
        let brick = bricks[i];
        if (!brick.alive) continue;
        
        if (ball.x + ball.radius < brick.x || ball.x - ball.radius > brick.x + brick.w) continue;
        if (ball.y + ball.radius < brick.y || ball.y - ball.radius > brick.y + brick.h) continue;

        brick.alive = false;

        let overlapLeft = (ball.x + ball.radius) - brick.x;
        let overlapRight = (brick.x + brick.w) - (ball.x - ball.radius);
        let overlapTop = (ball.y + ball.radius) - brick.y;
        let overlapBottom = (brick.y + brick.h) - (ball.y - ball.radius);
        let minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

        if (minOverlap === overlapLeft) {
            ball.speedX = -Math.abs(ball.speedX);
            ball.x = brick.x - ball.radius;
        } else if (minOverlap === overlapRight) {
            ball.speedX = Math.abs(ball.speedX);
            ball.x = brick.x + brick.w + ball.radius;
        } else if (minOverlap === overlapTop) {
            ball.speedY = -Math.abs(ball.speedY);
            ball.y = brick.y - ball.radius;
        } else if (minOverlap === overlapBottom) {
            ball.speedY = Math.abs(ball.speedY);
            ball.y = brick.y + brick.h + ball.radius;
        }

        if (brick.type === 'hold' || brick.type === 'mash') {
            gameOnSpecialBrickHit(brick.type, brick.tailLength);
        }
        return; 
    }
};

const uiSetNoteState = (type, tailLength = 0) => {
    resetBallState();
    if (type === 'hold' || type === 'mash') {
        ball.type = 'normal';
        ball.tailLength = 0;
        queueSpecialNote(type, tailLength);
    } else {
        ball.type = type;
        ball.tailLength = tailLength;
    }
};

const uiSetPaddleActive = (isActive) => {
    paddle.isPressed = isActive;
};

// ==========================================
// [3] 핵심 물리 연산 및 실시간 좌표 관리
// ==========================================
const updatePhysics = () => {
    if (keyLeft) paddle.x -= 6;
    if (keyRight) paddle.x += 6;
    if (paddle.x < 0) paddle.x = 0;
    if (paddle.x + paddle.width > canvas.width) paddle.x = canvas.width - paddle.width;

    activatePendingSpecial();
    updateTailGrow();

    if (activeHoldTail) {
        let step = activeHoldTail.speed;
        if (!activeHoldTail.absorbing) {
            activeHoldTail.nearX += activeHoldTail.moveX * step;
            activeHoldTail.nearY += activeHoldTail.moveY * step;
            activeHoldTail.farX += activeHoldTail.moveX * step;
            activeHoldTail.farY += activeHoldTail.moveY * step;
        } else {
            activeHoldTail.farX += activeHoldTail.moveX * step;
            activeHoldTail.farY += activeHoldTail.moveY * step;
            if (activeHoldTail.nearY < JUDGE_LINE_Y) {
                activeHoldTail.nearX += activeHoldTail.moveX * step;
                activeHoldTail.nearY += activeHoldTail.moveY * step;
            }
        }

        if (keyPaddleHeld && activeHoldTail.nearY >= JUDGE_LINE_Y - 4) {
            activeHoldTail.absorbing = true;
        }

        if (!activeHoldTail.releaseWindow && activeHoldTail.farY >= JUDGE_LINE_Y - GOOD_WINDOW) {
            activeHoldTail.releaseWindow = true;
        }

        if (!keyPaddleHeld && !activeHoldTail.releaseWindow && !activeHoldTail.missed && !activeHoldTail.released) {
            tryHoldTailReleaseOnOutsideMiss();
            return;
        }

        if (activeHoldTail && activeHoldTail.releaseWindow && keyPaddleHeld &&
            activeHoldTail.farY > JUDGE_LINE_Y + GOOD_WINDOW &&
            !activeHoldTail.released && !activeHoldTail.missed) {
            tryHoldTailReleaseOnOutsideMiss();
            return;
        }

        if (ball.heldOnPaddle) {
            if (ball.x < paddle.x || ball.x > paddle.x + paddle.width) {
                tryHoldTailReleaseOnOutsideMiss();
                return;
            }
        }

        if (activeHoldTail) {
            if (activeHoldTail.farY > canvas.height + 50 ||
                ((activeHoldTail.released || activeHoldTail.missed) && activeHoldTail.farY >= JUDGE_LINE_Y)) {
                activeHoldTail = null;
            }
        }
    }

    if (activeMashTail) {
        let isTailActive = false;
        let step = activeMashTail.speed;
        let hasPending = false; 

        activeMashTail.markers.forEach(marker => {
            if (marker.state === 'pending') {
                marker.x += activeMashTail.moveX * step;
                marker.y += activeMashTail.moveY * step;
                isTailActive = true;
                hasPending = true;

                if (marker.y > JUDGE_LINE_Y + GOOD_WINDOW) {
                    processJudgement('miss', { light: true });
                    marker.state = 'missed';
                }
            } else if (marker.state === 'missed' || marker.state === 'hit') {
                marker.x += activeMashTail.moveX * step;
                marker.y += activeMashTail.moveY * step;
                if (marker.y < canvas.height + ball.radius) isTailActive = true;
            }
        });

        if (ball.heldOnPaddle) {
            if (ball.x < paddle.x || ball.x > paddle.x + paddle.width) {
                processJudgement('miss');
                dropHeldBall();
                activeMashTail = null;
                hasPending = false;
            }
        }

        if (!hasPending && ball.heldOnPaddle) bounceBall();
        if (!isTailActive) activeMashTail = null;
    }

    if (ball.attached) {
        ball.x = paddle.x + paddle.width / 2;
        ball.y = paddle.y - ball.radius - 2;
    } else if (ball.heldOnPaddle) {
        ball.y = JUDGE_LINE_Y - ball.radius;
    } else {
        ball.x += ball.speedX;
        ball.y += ball.speedY;
    }

    if (!ball.attached && !ball.heldOnPaddle && (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width)) ball.speedX *= -1;
    if (!ball.attached && !ball.heldOnPaddle && ball.y - ball.radius < 0) ball.speedY *= -1;
    
    if (!ball.attached && !ball.heldOnPaddle) {
        checkBallBrickCollisions();
    }

    if (!ball.attached && ball.y > canvas.height) {
        processJudgement('miss'); 
        resetBallState();
    }
};

// ==========================================
// [4] Canvas 그래픽 드로잉 및 메인 렌더 루프
// ==========================================
const drawBricks = () => {
    bricks.forEach(brick => {
        if (!brick.alive) return;
        context.fillStyle = '#1a1a22';
        context.fillRect(brick.x, brick.y, brick.w, brick.h);
        let color = brick.type === 'hold' ? '#ffff00' : brick.type === 'mash' ? '#ff00ff' : '#00ffff';
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.strokeRect(brick.x, brick.y, brick.w, brick.h);
        if (brick.type === 'hold' || brick.type === 'mash') {
            context.fillStyle = color;
            context.font = '9px Orbitron'; 
            context.fillText(brick.type === 'hold' ? 'L' : 'M', brick.x + brick.w / 2 - 4, brick.y + 15);
        }
    });
};

const drawExtrudeTail = (headX, headY, length, dirX, dirY, color) => {
    if (length <= 0) return;
    let end = tailBackPoint(headX, headY, dirX, dirY, length);
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(headX, headY);
    context.lineWidth = ball.radius * 2;
    context.lineCap = 'round';
    context.strokeStyle = color;
    context.stroke();
};

const getBallTailDir = () => {
    if (tailGrow) return { x: tailGrow.dirX, y: tailGrow.dirY };
    if (ball.heldOnPaddle) {
        if (activeHoldTail) return { x: activeHoldTail.backX, y: activeHoldTail.backY };
        if (activeMashTail) return { x: activeMashTail.backX, y: activeMashTail.backY };
    }
    return getTailBackDir(ball.speedX, ball.speedY);
};

const drawPaddle = () => {
    context.beginPath(); 
    context.moveTo(0, paddle.y); 
    context.lineTo(canvas.width, paddle.y);
    context.lineWidth = 1; 
    context.strokeStyle = 'rgba(0, 255, 255, 0.4)'; 
    context.stroke();
    
    if (paddle.isPressed) { 
        let gradient = context.createLinearGradient(paddle.x, 0, paddle.x + paddle.width, 0);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)'); 
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.2)'); 
        context.fillStyle = gradient;
        context.fillRect(paddle.x, 0, paddle.width, paddle.y); 
    }

    context.fillStyle = paddle.isPressed ? '#ffffff' : '#000000'; 
    context.fillRect(paddle.x, paddle.y - (paddle.height / 2), paddle.width, paddle.height);
    context.lineWidth = 2; 
    context.strokeStyle = paddle.isPressed ? '#00ffff' : '#ffffff'; 
    context.strokeRect(paddle.x, paddle.y - (paddle.height / 2), paddle.width, paddle.height);
};

const drawApproachCircle = () => {
    if (!ball || !paddle) return;

    if (ball.y > approachTracker.lastY) {
        approachTracker.isDescending = true;
    } else if (ball.y < approachTracker.lastY) {
        approachTracker.isDescending = false;
    }
    approachTracker.lastY = ball.y;

    if (!approachTracker.isDescending || ball.y < EFFECT_SPAWN_Y || ball.y >= paddle.y) return;

    let totalDistance = paddle.y - EFFECT_SPAWN_Y;
    let currentDistance = paddle.y - ball.y;
    if (totalDistance <= 0 || currentDistance <= 0) return;

    let ratio = currentDistance / totalDistance;
    let currentRadius = ball.radius + (MAX_RADIUS - ball.radius) * ratio;

    context.beginPath();
    context.arc(ball.x, ball.y, currentRadius, 0, Math.PI * 2);
    context.lineWidth = 1.5;
    context.strokeStyle = `rgba(0, 255, 255, ${0.3 + (1 - ratio) * 0.5})`;
    context.stroke();
};

const render = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    updatePhysics();
    
    drawBricks();
    drawPaddle();
    drawApproachCircle();

    if (activeHoldTail) {
        let nx = activeHoldTail.nearX;
        let ny = activeHoldTail.absorbing ? JUDGE_LINE_Y : activeHoldTail.nearY;
        let fx = activeHoldTail.farX;
        let fy = Math.min(activeHoldTail.farY, JUDGE_LINE_Y);

        context.beginPath();
        context.moveTo(fx, fy);
        context.lineTo(nx, ny);
        context.lineWidth = ball.radius * 2;
        context.lineCap = 'round';
        context.strokeStyle = '#ffff00';
        context.stroke();
        
        if (activeHoldTail.absorbing && paddle.isPressed) {
            context.fillStyle = 'rgba(255, 255, 0, 0.15)';
            context.fillRect(paddle.x, paddle.y - paddle.height, paddle.width, paddle.height);
        }
    }

    if (activeMashTail) {
        let pendingMarkers = [];
        for(let i=0; i<activeMashTail.markers.length; i++) {
            if(activeMashTail.markers[i].state === 'pending') {
                pendingMarkers.push(activeMashTail.markers[i]);
            }
        }

        if (pendingMarkers.length > 0) {
            let far = pendingMarkers[pendingMarkers.length - 1];
            let near = pendingMarkers[0];
            let lead = tailBackPoint(far.x, far.y, activeMashTail.backX, activeMashTail.backY, 10);
            context.beginPath();
            context.moveTo(lead.x, lead.y);
            context.lineTo(ball.heldOnPaddle ? ball.x : near.x, ball.heldOnPaddle ? JUDGE_LINE_Y : near.y);
            context.lineWidth = ball.radius * 2;
            context.lineCap = 'round';
            context.strokeStyle = '#ff00ff';
            context.stroke();
        }

        activeMashTail.markers.forEach(marker => {
            context.beginPath();
            context.arc(marker.x, marker.y, ball.radius, 0, Math.PI * 2);
            if (marker.state === 'pending') {
                context.fillStyle = '#ffffff';
                context.fill();
            } else if (marker.state === 'missed') {
                context.fillStyle = '#444444';
                context.strokeStyle = '#ff00ff';
                context.lineWidth = 1;
                context.fill();
                context.stroke();
            }
        });
    }

    if (ball.type === 'hold' || ball.type === 'mash') {
        let displayLen = getBallTailDisplayLength();
        let dir = getBallTailDir();
        let color = ball.type === 'hold' ? '#ffff00' : '#ff00ff';
        drawExtrudeTail(ball.x, ball.y, displayLen, dir.x, dir.y, color);

        if (ball.type === 'mash' && displayLen > 0) {
            let spacing = ball.tailLength / MASH_MARKER_COUNT;
            for (let i = 1; i <= MASH_MARKER_COUNT; i++) {
                let dist = spacing * i;
                if (dist <= displayLen) {
                    let p = tailBackPoint(ball.x, ball.y, dir.x, dir.y, dist);
                    context.beginPath();
                    context.arc(p.x, p.y, ball.radius, 0, Math.PI * 2);
                    context.fillStyle = '#ffffff';
                    context.fill();
                }
            }
        }
    }

    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fillStyle = ball.type === 'hold' ? '#ffff00' : ball.type === 'mash' ? '#ff00ff' : ball.type === 'fake' ? '#b026ff' : '#00ffff';
    context.fill();

    if (ball.type === 'fake') {
        context.lineWidth = 2;
        context.strokeStyle = '#ffffff';
        context.stroke();
    }

    let nextEffects = [];
    for(let i=0; i<effects.length; i++){
        let ef = effects[i];
        ef.radius += 5; 
        ef.alpha -= 0.08;
        context.beginPath();
        context.arc(ef.x, ef.y, ef.radius, 0, Math.PI * 2);
        context.lineWidth = 2; 
        context.strokeStyle = `rgba(255, 255, 255, ${ef.alpha})`; 
        context.stroke();
        
        if(ef.alpha > 0) {
            nextEffects.push(ef);
        }
    }
    effects = nextEffects;

    requestAnimationFrame(render);
};

// ==========================================
// [5] 진입점 설정
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.querySelector('.canvas');
    context = canvas.getContext('2d');
    healthFill = document.querySelector(".hp-gauge-fill");
    healthSlot = document.querySelector(".hp-guage-slot");
    playScreen = document.querySelector(".play-screen");
    scoreBox = document.querySelector(".score-box");
    comboBox = document.querySelector(".combo-box");
    judgementDisplay = document.querySelector(".judgement-text");

    initInputListeners();
    uiUpdateHealth(hp);
    uiUpdateScoreAndCombo(score, combo);
    initTestBricks();
    
    window.gameOnSpecialBrickHit = gameOnSpecialBrickHit;

    render();
});
