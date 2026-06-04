let canvas, context;
let healthFill, healthSlot, playScreen, scoreBox, comboBox, judgementDisplay;

// 실시간 게임 상태 변수
let score = 0;
let combo = 0;
let hp = 100;

// 정적 오브젝트 초기 상태 및 속도 설정
let ball = {
    x: 250, y: 480, radius: 8,
    type: 'normal', tailLength: 0, specialLocked: false,
    speedX: 0, speedY: 0, 
    attached: true, 
    heldOnPaddle: false,  
    paddleOffsetX: 0,     
    earlyMissed: false    
};
let paddle = { x: 180, y: 520, width: 140, height: 12, isPressed: false };
let effects = []; 

// 판정선 및 입력 플래그
const JUDGE_LINE_Y = 520;
const PERFECT_WINDOW = 16;
const GOOD_WINDOW = 32;

const EFFECT_SPAWN_Y = 280;
const NORMAL_MISS_HP = 20;
const MASH_MISS_HP = 12;
const MASH_MARKER_COUNT = 3;
const TAIL_EXTRUDE_SPEED = 6;
const MAX_RADIUS = 45;

const BRICK_W = 52;
const BRICK_H = 22;
const BRICK_GAP = 6;
const BRICK_ROW_Y = 100;

let bricks = [];

const getTravelDir = (vx, vy) => {
    let len = Math.hypot(vx, vy);
    if (len < 0.01) return { x: 0, y: 1 };
    return { x: vx / len, y: vy / len };
};

const getTailBackDir = (vx, vy) => {
    let t = getTravelDir(vx, vy);
    return { x: -t.x, y: -t.y };
};

const tailBackPoint = (headX, headY, backX, backY, length) => {
    return { x: headX + backX * length, y: headY + backY * length };
};

const syncTailGrowDirection = () => {
    if (!tailGrow || ball.attached || ball.heldOnPaddle) return;
    let back = getTailBackDir(ball.speedX, ball.speedY);
    tailGrow.dirX = back.x;
    tailGrow.dirY = back.y;
};

let keyLeft = false;
let keyRight = false;
let keyPaddleHeld = false;

// 최초 특수 브릭 1회만 반응, 패들 반사 후 해제
let pendingSpecial = null;
let tailGrow = null;

// 분리되어 패들로 흡수되는 롱/연타 꼬리
let activeHoldTail = null;
let activeMashTail = null;

// 함수 호이스팅 방지용 사전 선언
let gameOnSpecialBrickHit, uiUpdateHealth, uiUpdateScoreAndCombo, initTestBricks;
let render, initInputListeners, tryMashMarkerHit, launchBallFromPaddle, bounceBall;
let processJudgement, uiHitParticle, startHoldTailFromBall, startMashTailFromBall;
let uiSetPaddleActive, tryHoldTailRelease, isSpecialStateBusy, queueSpecialNote;
let activatePendingSpecial, getBallTailDisplayLength, updateTailGrow, captureTailMotion;
let getMashMarkerInWindow, updatePhysics, checkBallBrickCollisions, uiShowJudgement;
let uiSetNoteState, animJudge, animCombo, animDamage, drawBricks, drawExtrudeTail;
let getBallTailDir, drawPaddle;

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

    window.gameOnSpecialBrickHit = gameOnSpecialBrickHit;

    initTestBricks();
    render();
});

initTestBricks = () => {
    const types = ['normal', 'hold', 'mash', 'normal'];
    const tailByType = { hold: 140, mash: 150 };
    const count = types.length;
    const totalW = count * BRICK_W + (count - 1) * BRICK_GAP;
    let startX = (500 - totalW) / 2;

    bricks = types.map((type, i) => ({
        x: startX + i * (BRICK_W + BRICK_GAP),
        y: BRICK_ROW_Y,
        w: BRICK_W,
        h: BRICK_H,
        type,
        tailLength: tailByType[type] || 0,
        alive: true
    }));
};

initInputListeners = () => {
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

            // 연타 노트 수동 타격 판정
            if (tryMashMarkerHit()) return;

            // EARLY 꼼수 방지
            if (ball.speedY > 0 && !ball.heldOnPaddle && !ball.earlyMissed) {
                let dist = JUDGE_LINE_Y - ball.y;
                if (dist > GOOD_WINDOW && dist <= 200) {
                    processJudgement('miss');
                    ball.earlyMissed = true; 
                    return;
                }
            }

            // 본체 공 판정
            if (ball.speedY > 0 && Math.abs(ball.y - JUDGE_LINE_Y) <= GOOD_WINDOW && !ball.earlyMissed) {
                if (ball.x >= paddle.x && ball.x <= paddle.x + paddle.width) {
                    if (ball.type === 'fake') return;

                    let diff = Math.abs(ball.y - JUDGE_LINE_Y);
                    let judge = diff <= PERFECT_WINDOW ? 'perfect' : 'good';

                    if (ball.type === 'normal') {
                        processJudgement(judge);
                        uiHitParticle(ball.x, JUDGE_LINE_Y);
                        bounceBall();
                    } else if (ball.type === 'hold') {
                        processJudgement(judge);
                        uiHitParticle(ball.x, JUDGE_LINE_Y);
                        startHoldTailFromBall();
                        
                        ball.heldOnPaddle = true;
                        ball.paddleOffsetX = ball.x - paddle.x;
                        ball.y = JUDGE_LINE_Y - ball.radius;
                        ball.speedX = 0; ball.speedY = 0;
                    } else if (ball.type === 'mash') {
                        processJudgement(judge);
                        uiHitParticle(ball.x, JUDGE_LINE_Y);
                        startMashTailFromBall();
                        
                        ball.heldOnPaddle = true;
                        ball.paddleOffsetX = ball.x - paddle.x;
                        ball.y = JUDGE_LINE_Y - ball.radius;
                        ball.speedX = 0; ball.speedY = 0;
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

isSpecialStateBusy = () => {
    return ball.specialLocked || pendingSpecial || activeHoldTail || activeMashTail;
};

gameOnSpecialBrickHit = (type, tailLength = 160) => {
    if (type !== 'hold' && type !== 'mash') return false;
    if (isSpecialStateBusy()) return false;
    pendingSpecial = { type, tailLength };
    return true;
};

queueSpecialNote = (type, tailLength) => {
    if (isSpecialStateBusy()) return;
    pendingSpecial = { type, tailLength };
};

activatePendingSpecial = () => {
    if (!pendingSpecial || ball.y < EFFECT_SPAWN_Y) return;

    ball.type = pendingSpecial.type;
    ball.tailLength = pendingSpecial.tailLength;
    ball.specialLocked = true;
    let back = getTailBackDir(ball.speedX, ball.speedY);
    tailGrow = {
        length: pendingSpecial.tailLength,
        current: 0,
        dirX: back.x,
        dirY: back.y,
        originX: ball.x,
        originY: ball.y
    };
    pendingSpecial = null;
};

getBallTailDisplayLength = () => {
    // [버그 수정] 대가리가 패들에 홀드되어 있으면 본체의 가짜 고정 꼬리 이미지를 숨깁니다.
    if (ball.heldOnPaddle) return 0; 
    
    if (tailGrow) return tailGrow.current;
    if (ball.type === 'hold' || ball.type === 'mash') return ball.tailLength;
    return 0;
};

updateTailGrow = () => {
    if (!tailGrow || tailGrow.current >= tailGrow.length) return;
    syncTailGrowDirection();
    tailGrow.current = Math.min(tailGrow.length, tailGrow.current + TAIL_EXTRUDE_SPEED);
};

captureTailMotion = (vx, vy) => {
    let travel = getTravelDir(vx, vy);
    let back = getTailBackDir(vx, vy);
    let speed = Math.hypot(vx, vy) || 3;
    return { moveX: travel.x, moveY: travel.y, backX: back.x, backY: back.y, speed };
};

startHoldTailFromBall = () => {
    let tailLen = getBallTailDisplayLength() || ball.tailLength;
    let motion = captureTailMotion(ball.speedX, ball.speedY);
    let far = tailBackPoint(ball.x, ball.y, motion.backX, motion.backY, tailLen);
    activeHoldTail = {
        nearX: ball.x, nearY: ball.y, farX: far.x, farY: far.y,
        moveX: motion.moveX, moveY: motion.moveY, backX: motion.backX, backY: motion.backY,
        speed: motion.speed, missed: false, released: false, releaseWindow: false, absorbing: false
    };
};

startMashTailFromBall = () => {
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
        speed: motion.speed, markers
    };
};

getMashMarkerInWindow = () => {
    if (!activeMashTail) return null;
    let inWindow = activeMashTail.markers.filter(m => {
        if (m.state !== 'pending') return false;
        if (m.x < paddle.x || m.x > paddle.x + paddle.width) return false;
        return Math.abs(m.y - JUDGE_LINE_Y) <= GOOD_WINDOW;
    });
    if (inWindow.length === 0) return null;
    return inWindow.reduce((best, m) => (m.y > best.y ? m : best));
};

tryMashMarkerHit = () => {
    let targetMarker = getMashMarkerInWindow();
    if (!targetMarker) return false;

    let diff = Math.abs(targetMarker.y - JUDGE_LINE_Y);
    let judge = diff <= PERFECT_WINDOW ? 'perfect' : 'good';
    processJudgement(judge);
    uiHitParticle(targetMarker.x, JUDGE_LINE_Y);
    targetMarker.state = 'hit';
    return true;
};

tryHoldTailRelease = () => {
    if (!activeHoldTail || activeHoldTail.missed || activeHoldTail.released) return;

    if (!activeHoldTail.releaseWindow) {
        processJudgement('miss');
        activeHoldTail.missed = true;
        if (ball.heldOnPaddle) {
            ball.heldOnPaddle = false;
            ball.speedY = 3;
        }
        return;
    }

    let diff = Math.abs(activeHoldTail.farY - JUDGE_LINE_Y);
    let judge = diff <= PERFECT_WINDOW ? 'perfect' : diff <= GOOD_WINDOW ? 'good' : 'miss';
    processJudgement(judge);
    
    if (judge !== 'miss') {
        uiHitParticle(activeHoldTail.farX, JUDGE_LINE_Y);
        if (ball.heldOnPaddle) bounceBall();
    } else {
        if (ball.heldOnPaddle) {
            ball.heldOnPaddle = false;
            ball.speedY = 3;
        }
    }
    activeHoldTail.released = true;
};

launchBallFromPaddle = () => {
    ball.attached = false;
    ball.heldOnPaddle = false;
    ball.earlyMissed = false;
    ball.x = paddle.x + paddle.width / 2;
    ball.y = paddle.y - ball.radius - 2;
    ball.speedX = 0;
    ball.speedY = -5;
};

bounceBall = () => {
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

processJudgement = (type, options = {}) => {
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

updatePhysics = () => {
    if (keyLeft) paddle.x -= 6;
    if (keyRight) paddle.x += 6;
    if (paddle.x < 0) paddle.x = 0;
    if (paddle.x + paddle.width > canvas.width) paddle.x = canvas.width - paddle.width;

    activatePendingSpecial();
    updateTailGrow();

    // 롱노트 물리 및 유지 검사
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
            processJudgement('miss');
            activeHoldTail.missed = true;
            if (ball.heldOnPaddle) { ball.heldOnPaddle = false; ball.speedY = 3; }
        }

        if (activeHoldTail.releaseWindow && keyPaddleHeld &&
            activeHoldTail.farY > JUDGE_LINE_Y + GOOD_WINDOW &&
            !activeHoldTail.released && !activeHoldTail.missed) {
            processJudgement('miss');
            activeHoldTail.missed = true;
            if (ball.heldOnPaddle) { ball.heldOnPaddle = false; ball.speedY = 3; }
        }

        if (activeHoldTail.farY > canvas.height + 50 ||
            ((activeHoldTail.released || activeHoldTail.missed) && activeHoldTail.farY >= JUDGE_LINE_Y)) {
            activeHoldTail = null;
        }
    }

    // 연타 물리 및 대기 검사
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

        if (!hasPending && ball.heldOnPaddle) bounceBall();
        
        if (!isTailActive) activeMashTail = null;
    }

    // [버그 수정 2] 공 이동 좌표 계산 전 X값 기억
    let prevBallX = ball.x;

    if (ball.attached || ball.heldOnPaddle) {
        if (ball.attached) {
            ball.x = paddle.x + paddle.width / 2;
            ball.y = paddle.y - ball.radius - 2;
        } else if (ball.heldOnPaddle) {
            ball.x = paddle.x + ball.paddleOffsetX;
            ball.y = JUDGE_LINE_Y - ball.radius;
        }
    } else {
        ball.x += ball.speedX;
        ball.y += ball.speedY;
    }

    // [버그 수정 3] 대가리가 패들에 잡혀 이동할 때 꼬리들도 동기화해서 X축 이동
    let dx = ball.x - prevBallX;
    if (ball.heldOnPaddle && dx !== 0) {
        if (activeHoldTail) {
            activeHoldTail.nearX += dx;
            activeHoldTail.farX += dx;
        }
        if (activeMashTail) {
            activeMashTail.anchorX += dx;
            activeMashTail.markers.forEach(m => {
                if (m.state === 'pending') m.x += dx;
            });
        }
    }

    if (!ball.attached && !ball.heldOnPaddle && (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width)) ball.speedX *= -1;
    if (!ball.attached && !ball.heldOnPaddle && ball.y - ball.radius < 0) ball.speedY *= -1;
    if (!ball.attached && !ball.heldOnPaddle) checkBallBrickCollisions();

    if (!ball.attached && ball.y > canvas.height) {
        if (!ball.earlyMissed) processJudgement('miss'); 
        ball.attached = true;
        ball.heldOnPaddle = false;
        ball.earlyMissed = false;
        ball.speedX = 0;
        ball.speedY = 0;
        ball.type = 'normal';
        ball.tailLength = 0;
        ball.specialLocked = false;
        tailGrow = null;
        pendingSpecial = null;
        activeHoldTail = null;
        activeMashTail = null;
    }
};

checkBallBrickCollisions = () => {
    for (let brick of bricks) {
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

/* ========== API 목록 ========== */
uiUpdateHealth = (hpValue) => {
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

uiUpdateScoreAndCombo = (scoreValue, comboValue) => {
    score = scoreValue;
    combo = comboValue;
    let scoreStr = score.toString();
    while (scoreStr.length < 6) scoreStr = "0" + scoreStr;
    scoreBox.textContent = scoreStr;
    
    if (combo > 0) {
        animCombo();
        comboBox.innerHTML = combo + "<span>COMBO</span>"; 
        comboBox.style.opacity = "1"; 
    } else { 
        comboBox.style.opacity = "0"; 
    }
};

uiShowJudgement = (judgeType) => {
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

uiHitParticle = (x, y) => {
    effects.push({ x: x, y: y, radius: 10, alpha: 1 });
};

uiSetNoteState = (type, tailLength = 0) => {
    ball.attached = true;
    ball.heldOnPaddle = false;
    ball.earlyMissed = false;
    ball.speedX = 0;
    ball.speedY = 0;
    activeHoldTail = null;
    activeMashTail = null;
    pendingSpecial = null;
    tailGrow = null;
    ball.specialLocked = false;

    if (type === 'hold' || type === 'mash') {
        ball.type = 'normal';
        ball.tailLength = 0;
        queueSpecialNote(type, tailLength);
    } else {
        ball.type = type;
        ball.tailLength = tailLength;
    }
};

uiSetPaddleActive = (isActive) => {
    paddle.isPressed = isActive;
};

/* ========== 내부 애니메이션 루틴 ========== */
let judgeTimer = null; 
animJudge = (text, judgeType) => {
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

let comboTimer = null;
animCombo = () => {
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

let damageTimer = null;
animDamage = () => {
    if (damageTimer) clearTimeout(damageTimer);
    healthFill.style.background = "#ffffff";
    healthFill.style.boxShadow = "0 0 40px #ffffff, inset 0 0 20px #ffffff";
    damageTimer = setTimeout(() => { uiUpdateHealth(hp); }, 100);
};

/* ========== 렌더 루프 ========== */
drawBricks = () => {
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

drawExtrudeTail = (headX, headY, length, dirX, dirY, color) => {
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

getBallTailDir = () => {
    if (tailGrow) return { x: tailGrow.dirX, y: tailGrow.dirY };
    if (ball.heldOnPaddle) {
        if (activeHoldTail) return { x: activeHoldTail.backX, y: activeHoldTail.backY };
        if (activeMashTail) return { x: activeMashTail.backX, y: activeMashTail.backY };
    }
    return getTailBackDir(ball.speedX, ball.speedY);
};

render = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    updatePhysics();
    drawBricks();
    drawPaddle();

    if (activeHoldTail) {
        let nx = activeHoldTail.nearX;
        let ny = activeHoldTail.nearY;
        if (activeHoldTail.absorbing) {
            ny = JUDGE_LINE_Y;
        }
        
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
        let pendingMarkers = activeMashTail.markers.filter(m => m.state === 'pending');
        if (pendingMarkers.length > 0) {
            let far = pendingMarkers[pendingMarkers.length - 1];
            let near = pendingMarkers[0];
            let lead = tailBackPoint(far.x, far.y, activeMashTail.backX, activeMashTail.backY, 10);
            context.beginPath();
            context.moveTo(lead.x, lead.y);
            // [버그 수정 4] 대가리가 고정되어 있으면 연타 꼬리 선이 공 위치까지 완전히 이어지게 함
            if (ball.heldOnPaddle) {
                context.lineTo(ball.x, JUDGE_LINE_Y);
            } else {
                context.lineTo(near.x, near.y);
            }
            context.lineWidth = ball.radius * 2;
            context.lineCap = 'round';
            context.strokeStyle = '#ff00ff';
            context.stroke();
        }

        activeMashTail.markers.forEach(marker => {
            if (marker.state === 'pending') {
                context.beginPath();
                context.arc(marker.x, marker.y, ball.radius, 0, Math.PI * 2);
                context.fillStyle = '#ffffff';
                context.fill();
            } else if (marker.state === 'missed') {
                context.beginPath();
                context.arc(marker.x, marker.y, ball.radius, 0, Math.PI * 2);
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

    effects = effects.filter(ef => {
        ef.radius += 5; ef.alpha -= 0.08;
        context.beginPath();
        context.arc(ef.x, ef.y, ef.radius, 0, Math.PI * 2);
        context.lineWidth = 2; context.strokeStyle = `rgba(255, 255, 255, ${ef.alpha})`; context.stroke();
        return ef.alpha > 0;
    });

    requestAnimationFrame(render);
};

drawPaddle = () => {
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

let approachTracker = {
    lastY: ball.y,
    isDescending: false
};

function drawApproachCircle() {
    if (!ball || !paddle) return;

    if (ball.y > approachTracker.lastY) {
        approachTracker.isDescending = true;
    } else if (ball.y < approachTracker.lastY) {
        approachTracker.isDescending = false;
    }
    approachTracker.lastY = ball.y;

    if (!approachTracker.isDescending || ball.y < EFFECT_SPAWN_Y || ball.y >= paddle.y) {
        return;
    }

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
}

const originalRender = render;

render = function() {
    originalRender();
    drawApproachCircle();
};
