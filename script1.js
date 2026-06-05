let canvas, context;
let healthFill, healthSlot, playScreen, scoreBox, comboBox, judgementDisplay;

// 실시간 게임 상태 변수
let score = 0;
let combo = 0;
let hp = 100;
let isGameOver = false;

// ── 난이도 시스템 ──
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const DIFFICULTY_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
let currentDifficulty = null; // null = 선택 화면

const DIFFICULTY_CONFIG = {
    easy: {
        ballSpeedY: -2.2,
        ballBounceY: -2.0,
        ballBounceX: 2.0,
        paddleWidth: 170,
        brickTypes: ['normal', 'normal'],
        tailByType: {}
    },
    normal: {
        ballSpeedY: -3,
        ballBounceY: -2.5,
        ballBounceX: 2.5,
        paddleWidth: 140,
        brickTypes: ['normal', 'hold', 'mash', 'normal'],
        tailByType: { hold: 140, mash: 150 }
    },
    hard: {
        ballSpeedY: -4,
        ballBounceY: -3.5,
        ballBounceX: 3.5,
        paddleWidth: 110,
        brickTypes: ['mash', 'normal', 'hold', 'mash', 'normal', 'hold'],
        tailByType: { hold: 140, mash: 150 }
    }
};

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

//추가
const HOLD_RELEASE_WINDOW = 80;

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

// mash 블럭 파괴 시 생성되는 일직선 공들
let mashBalls = [];

// 함수 호이스팅 방지용 사전 선언
let gameOnSpecialBrickHit, uiUpdateHealth, uiUpdateScoreAndCombo, initTestBricks;
let render, initInputListeners, tryMashMarkerHit, launchBallFromPaddle, bounceBall;
let processJudgement, uiHitParticle, startHoldTailFromBall, startMashTailFromBall;
let uiSetPaddleActive, tryHoldTailRelease, isSpecialStateBusy, queueSpecialNote;
let activatePendingSpecial, getBallTailDisplayLength, updateTailGrow, captureTailMotion;
let getMashMarkerInWindow, updatePhysics, checkBallBrickCollisions, uiShowJudgement;
let uiSetNoteState, animJudge, animCombo, animDamage, drawBricks, drawExtrudeTail;
let getBallTailDir, drawPaddle, dropHeldBall, spawnMashBalls;
let triggerGameOver, restartGame, checkStageClear, triggerStageClear;

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

    showDifficultySelect(); // 난이도 선택 먼저
});

initTestBricks = () => {
    const cfg = DIFFICULTY_CONFIG[currentDifficulty] || DIFFICULTY_CONFIG.normal;
    const types = cfg.brickTypes;
    const tailByType = cfg.tailByType;
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

            if (mashBalls.length > 0) {
                let bestMb = null;
                let bestDist = Infinity;
                for (let mb of mashBalls) {
                    if (mb.gone) continue;         
                    if (mb.speedY <= 0) continue; 
                    let dist = Math.abs(mb.y - JUDGE_LINE_Y);
                    if (dist <= GOOD_WINDOW && dist < bestDist) {
                        bestDist = dist;
                        bestMb = mb;
                    }
                }
                if (bestMb) {
                    let judge = bestDist <= PERFECT_WINDOW ? 'perfect' : 'good';
                    processJudgement(judge);
                    uiHitParticle(bestMb.x, JUDGE_LINE_Y);
                    let hitPoint = (bestMb.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
                    bestMb.speedX = hitPoint * 2;
                    bestMb.speedY = -3;
                    bestMb.bounced = true;  
                    bestMb.earlyMissed = false;
                } else {
                    let hasActive = mashBalls.some(mb => !mb.gone && mb.speedY > 0);
                    if (hasActive) processJudgement('miss');
                }
                return;
            }


            if (ball.attached) {
                launchBallFromPaddle();
                return;
            }

            if (tryMashMarkerHit()) return;

            if (ball.speedY > 0 && !ball.heldOnPaddle && !ball.earlyMissed) {
                let dist = JUDGE_LINE_Y - ball.y;
                if (dist > GOOD_WINDOW && dist <= 200) {
                    processJudgement('miss');
                    ball.earlyMissed = true;
                    return;
                }
            }

            if (ball.speedY > 0 && Math.abs(ball.y - JUDGE_LINE_Y) <= GOOD_WINDOW && !ball.earlyMissed) {
                if (ball.x >= paddle.x && ball.x <= paddle.x + paddle.width) {
                    if (ball.type === 'fake') return;

                    let diff = Math.abs(ball.y - JUDGE_LINE_Y);
                    let judge = diff <= PERFECT_WINDOW ? 'perfect' : 'good';

                    if (ball.type === 'normal' && pendingSpecial && pendingSpecial.type === 'hold') {
                        // hold 브릭을 깼고 공이 normal로 내려온 경우 → 패들에서 hold 활성화
                        ball.type = 'hold';
                        ball.tailLength = pendingSpecial.tailLength;
                        ball.specialLocked = true;
                        pendingSpecial = null;
                        processJudgement(judge);
                        uiHitParticle(ball.x, JUDGE_LINE_Y);
                        startHoldTailFromBall();
                        ball.heldOnPaddle = true;
                        ball.paddleOffsetX = ball.x - paddle.x;
                        ball.y = JUDGE_LINE_Y - ball.radius;
                        ball.speedX = 0; ball.speedY = 0;
                    } else if (ball.type === 'normal') {
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
    if (type === 'mash') {
        spawnMashBalls();
        return true;
    }
    if (isSpecialStateBusy()) return false;
    pendingSpecial = { type, tailLength };
    return true;
};

spawnMashBalls = () => {
    // 원래 공과 같은 방향으로 일정 간격을 두고 4개가 일직선으로 줄줄이 나옴
    const SPACING = 40;
    const speed = Math.hypot(ball.speedX, ball.speedY) || 3.5;
    const dirX = speed ? ball.speedX / speed : 0;
    const dirY = speed ? ball.speedY / speed : -1;

    const MASH_SPEED = 1.8; // 내려오는 속도 (느리게)
    mashBalls = Array.from({ length: 4 }, (_, i) => ({
        x: ball.x - dirX * SPACING * i,
        y: ball.y - dirY * SPACING * i,
        radius: ball.radius,
        speedX: dirX * MASH_SPEED,
        speedY: dirY * MASH_SPEED,
        earlyMissed: false,
        bounced: false,
        gone: false
    }));

    // 원래 공 숨김 (attached 상태로 대기)
    ball.attached = true;
    ball.speedX = 0;
    ball.speedY = 0;
};

queueSpecialNote = (type, tailLength) => {
    if (isSpecialStateBusy()) return;
    pendingSpecial = { type, tailLength };
};

activatePendingSpecial = () => {
    if (!pendingSpecial || pendingSpecial.fromBrick || ball.y < EFFECT_SPAWN_Y) return;

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
    const MARKER_SPACING_Y = 60;
    let markers = [];
    for (let i = 1; i <= MASH_MARKER_COUNT; i++) {
        // heldOnPaddle 상태이므로 마커를 판정선 위에 순서대로 배치
        markers.push({
            x: ball.x,
            y: JUDGE_LINE_Y - MARKER_SPACING_Y * (i - 1),
            state: 'pending'
        });
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
        // heldOnPaddle 중에는 x 범위 체크 생략 (마커가 ball.x에 고정되어 있음)
        if (!ball.heldOnPaddle) {
            if (m.x < paddle.x || m.x > paddle.x + paddle.width) return false;
        }
        return Math.abs(m.y - JUDGE_LINE_Y) <= GOOD_WINDOW;
    });
    if (inWindow.length === 0) return null;
    // 판정선에 가장 가까운 마커 반환
    return inWindow.reduce((best, m) => (Math.abs(m.y - JUDGE_LINE_Y) < Math.abs(best.y - JUDGE_LINE_Y) ? m : best));
};
/*
tryMashMarkerHit = () => {
    let targetMarker = getMashMarkerInWindow();
    if (!targetMarker) return false;

    let diff = Math.abs(targetMarker.y - JUDGE_LINE_Y);
    let judge = diff <= PERFECT_WINDOW ? 'perfect' : 'good';
    processJudgement(judge);
    uiHitParticle(targetMarker.x, JUDGE_LINE_Y);
    targetMarker.state = 'hit';
    return true;
};*/
// tryMashMarkerHit 함수 전체 교체
tryMashMarkerHit = () => {
    if (!activeMashTail) return false;
    
    let targetMarker = getMashMarkerInWindow();
    if (!targetMarker) return false;

    let diff = Math.abs(targetMarker.y - JUDGE_LINE_Y);
    let judge = diff <= PERFECT_WINDOW ? 'perfect' : 'good';
    
    processJudgement(judge);
    uiHitParticle(targetMarker.x, JUDGE_LINE_Y);
    targetMarker.state = 'hit'; // 마커 처리

    // 모든 마커가 처리되었는지 확인
    let allDone = activeMashTail.markers.every(m => m.state !== 'pending');
    if (allDone) {
        activeMashTail = null; // 꼬리 먼저 정리
        bounceBall();          // 그 다음 공을 튕김 (heldOnPaddle 해제 포함)
    }
    
    return true;
};

// [추가] 꼬리 투하 시 본체 공의 꼬리 속성을 완전히 파괴하고 일반 공으로 리셋하는 헬퍼 함수
dropHeldBall = () => {
    if (ball.heldOnPaddle) {
        ball.heldOnPaddle = false;
        ball.speedY = 3;
        ball.type = 'normal'; // 더 이상 꼬리를 그리지 않음
        ball.tailLength = 0;
        tailGrow = null;
    }
};
tryHoldTailRelease = () => {

    if (!activeHoldTail) return;

    if (activeHoldTail.missed) return;

    let diff = Math.abs(
        activeHoldTail.farY - JUDGE_LINE_Y
    );

    let judge;

    if (diff <= PERFECT_WINDOW) {
        judge = 'perfect';
    }
    else if (diff <= HOLD_RELEASE_WINDOW) {
        judge = 'good';
    }
    else {
        judge = 'miss';
    }

    processJudgement(judge);

    if (judge !== 'miss') {

        uiHitParticle(
            activeHoldTail.farX,
            JUDGE_LINE_Y
        );

        if (ball.heldOnPaddle) {
            bounceBall();
        }
    }
    else {
        ball.earlyMissed = true;
        dropHeldBall();
    }

    activeHoldTail = null;
};

launchBallFromPaddle = () => {
    const cfg = DIFFICULTY_CONFIG[currentDifficulty] || DIFFICULTY_CONFIG.normal;
    ball.attached = false;
    ball.heldOnPaddle = false;
    ball.earlyMissed = false;
    ball.x = paddle.x + paddle.width / 2;
    ball.y = paddle.y - ball.radius - 2;
    ball.speedX = 0;
    ball.speedY = cfg.ballSpeedY;
    ball.specialLocked = false;
    tailGrow = null;
    activeMashTail = null;
};

bounceBall = () => {
    const cfg = DIFFICULTY_CONFIG[currentDifficulty] || DIFFICULTY_CONFIG.normal;
    ball.attached = false;
    ball.heldOnPaddle = false;
    ball.earlyMissed = false;
    ball.speedY = cfg.ballBounceY;
    let hitPoint = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
    ball.speedX = hitPoint * cfg.ballBounceX;
    ball.type = 'normal';
    ball.tailLength = 0;
    ball.specialLocked = false;
    tailGrow = null;
    activeMashTail = null;
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
    if (hp <= 0) triggerGameOver();
};

updatePhysics = () => {
    if (keyLeft) paddle.x -= 6;
    if (keyRight) paddle.x += 6;
    if (paddle.x < 0) paddle.x = 0;
    if (paddle.x + paddle.width > canvas.width) paddle.x = canvas.width - paddle.width;

    activatePendingSpecial();
    updateTailGrow();

    // ── mashBalls 물리 ──
    if (mashBalls.length > 0) {
        const VELOCITY_SCALE = 0.8;
        mashBalls.forEach(mb => {
            if (mb.gone) return;
            mb.x += mb.speedX * VELOCITY_SCALE;
            mb.y += mb.speedY * VELOCITY_SCALE;
            if (mb.x - mb.radius < 0 || mb.x + mb.radius > canvas.width) mb.speedX *= -1;
            // 천장에 닿으면 아래로 튕김 (다시 내려와서 판정 기회)
            if (mb.y - mb.radius < 0) {
                mb.speedY = Math.abs(mb.speedY); // 반드시 아래 방향으로
                mb.y = mb.radius;
                mb.bounced = false; // 다시 내려오는 중 — 판정 가능 상태로 초기화
            }
            // 화면 아래로 떨어지면 miss 처리 후 제거
            if (mb.y > canvas.height + mb.radius) {
                if (!mb.earlyMissed) processJudgement('miss');
                mb.gone = true;
            }
        });
        if (mashBalls.every(mb => mb.gone)) {
            mashBalls = [];
            ball.attached = true;
            ball.speedX = 0;
            ball.speedY = 0;
            ball.type = 'normal';
            ball.tailLength = 0;
            ball.specialLocked = false;
            tailGrow = null;
        }
    }

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

        if (!activeHoldTail.releaseWindow &&
            activeHoldTail.farY >= JUDGE_LINE_Y - HOLD_RELEASE_WINDOW) {

            activeHoldTail.releaseWindow = true;
        }

        if (!keyPaddleHeld && !activeHoldTail.releaseWindow && !activeHoldTail.missed && !activeHoldTail.released) {
            processJudgement('miss');
            ball.earlyMissed = true; 
            dropHeldBall(); 
            activeHoldTail = null; 
        }

        if (
            activeHoldTail &&
            activeHoldTail.farY > JUDGE_LINE_Y + HOLD_RELEASE_WINDOW &&
            !activeHoldTail.released &&
            !activeHoldTail.missed
        ) {
            processJudgement('miss');
            ball.earlyMissed = true;

            dropHeldBall();
            activeHoldTail = null;
        }
        if (activeHoldTail) {
            if (activeHoldTail.farY > canvas.height + 50 ||
                ((activeHoldTail.released || activeHoldTail.missed) && activeHoldTail.farY >= JUDGE_LINE_Y)) {
                activeHoldTail = null;
            }
        }
    }

    
    if (activeMashTail) {
        let step = activeMashTail.speed;

        if (ball.heldOnPaddle) {
            // heldOnPaddle 상태: pending 마커들을 판정선 위에서 60px 간격으로 순서대로 내려옴
            const MARKER_SPACING_Y = 60;
            let pendingMarkers = activeMashTail.markers.filter(m => m.state === 'pending');
            pendingMarkers.forEach((marker, idx) => {
                // x는 항상 ball.x로 맞춤
                marker.x = ball.x;
                // idx=0이 가장 먼저 판정선에 도달, 뒤 마커들은 위에 줄줄이 대기
                let targetY = JUDGE_LINE_Y - MARKER_SPACING_Y * idx;
                if (marker.y > targetY) marker.y = targetY;
                // 판정선을 향해 천천히 내려옴
                if (marker.y < targetY) marker.y += 3;
            });
        } else {
            // 튕겨 나간 후 마커 이동
            activeMashTail.markers.forEach(marker => {
                if (marker.state === 'pending') {
                    marker.x += activeMashTail.moveX * step;
                    marker.y += activeMashTail.moveY * step;
                }
            });
        }

        // 모든 마커가 처리되었으면 꼬리 해제
        if (activeMashTail.markers.every(m => m.state !== 'pending')) {
            activeMashTail = null;
        }
    }

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
        const VELOCITY_SCALE = 0.8; 
        ball.x += ball.speedX * VELOCITY_SCALE;
        ball.y += ball.speedY * VELOCITY_SCALE;
    }

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

    // mashBalls도 벽돌 충돌 체크
    if (mashBalls.length > 0) {
        for (let mb of mashBalls) {
            if (mb.gone) continue;
            for (let brick of bricks) {
                if (!brick.alive) continue;
                if (mb.x + mb.radius < brick.x || mb.x - mb.radius > brick.x + brick.w) continue;
                if (mb.y + mb.radius < brick.y || mb.y - mb.radius > brick.y + brick.h) continue;

                brick.alive = false;

                let overlapLeft   = (mb.x + mb.radius) - brick.x;
                let overlapRight  = (brick.x + brick.w) - (mb.x - mb.radius);
                let overlapTop    = (mb.y + mb.radius) - brick.y;
                let overlapBottom = (brick.y + brick.h) - (mb.y - mb.radius);
                let minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

                if (minOverlap === overlapLeft)        { mb.speedX = -Math.abs(mb.speedX); mb.x = brick.x - mb.radius; }
                else if (minOverlap === overlapRight)  { mb.speedX =  Math.abs(mb.speedX); mb.x = brick.x + brick.w + mb.radius; }
                else if (minOverlap === overlapTop)    { mb.speedY = -Math.abs(mb.speedY); mb.y = brick.y - mb.radius; }
                else if (minOverlap === overlapBottom) { mb.speedY =  Math.abs(mb.speedY); mb.y = brick.y + brick.h + mb.radius; }

                // hold 벽돌이면: 파란 공이 hold 브릭 깰 때와 동일하게 처리
                if (brick.type === 'hold') {
                    // mashBall → 메인 ball로 전환 (normal 상태로), hold는 패들에서 활성화
                    mashBalls = [];                         // 나머지 mash 공 제거
                    ball.attached = false;
                    ball.heldOnPaddle = false;
                    ball.earlyMissed = false;
                    ball.x = mb.x;
                    ball.y = mb.y;
                    ball.speedX = mb.speedX;
                    ball.speedY = mb.speedY;
                    ball.type = 'normal';
                    ball.tailLength = 0;
                    ball.specialLocked = false;
                    tailGrow = null;
                    activeHoldTail = null;
                    activeMashTail = null;
                    pendingSpecial = { type: 'hold', tailLength: brick.tailLength || 160, fromBrick: true };
                } else if (brick.type === 'mash') {
                    // mash 공이 또 다른 mash 벽돌을 깨도 무시 (이미 mash 중)
                }
                checkStageClear();
                break;
            }
        }
    }

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
            // 어떤 공 타입이든(fake 포함) 반드시 작동하도록 상태 강제 초기화
            ball.specialLocked = false;
            ball.tailLength = 0;
            tailGrow = null;
            pendingSpecial = null;
            activeHoldTail = null;
            activeMashTail = null;

            if (brick.type === 'mash') {
                ball.type = 'normal';
                spawnMashBalls();
            } else {
                // hold: 공은 normal 상태로 내려오고, 타입/꼬리는 패들에서 받을 때 활성화
                ball.type = 'normal';
                pendingSpecial = { type: 'hold', tailLength: brick.tailLength || 160, fromBrick: true };
            }
        }
        checkStageClear();
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
    if (length <= ball.radius) return;
    // 꼬리 시작점을 공 중심이 아니라 공 표면(반지름만큼 뒤)에서 시작
    let tailStartX = headX + dirX * ball.radius;
    let tailStartY = headY + dirY * ball.radius;
    let end = tailBackPoint(headX, headY, dirX, dirY, length);
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(tailStartX, tailStartY);
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

    if (activeHoldTail && !ball.heldOnPaddle) {
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

    // hold/mash 공 렌더링
    if (ball.type === 'hold' || ball.type === 'mash') {
        let color = ball.type === 'hold' ? '#ffff00' : '#ff00ff';

        // activeHoldTail이 없을 때(공이 날아다니는 중)만 공에 꼬리를 붙여 그림
        // activeHoldTail이 있으면 꼬리는 위 블록에서 이미 그렸으므로 공 본체만 그림
        if (!activeHoldTail) {
            let displayLen = getBallTailDisplayLength();
            let dir = getBallTailDir();
            // 1) 꼬리 선
            drawExtrudeTail(ball.x, ball.y, displayLen, dir.x, dir.y, color);
            // 2) mash 마커 점들
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

        // 3) 공 본체 (항상 꼬리 위에 덮어 그림)
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
    }

    // mashBalls 렌더링 (hit=false: 아직 안 쳤거나 miss, bounced=true: 쳐서 튕겨 올라가는 중)
    mashBalls.forEach(mb => {
        if (mb.gone) return; // 완전히 사라진 공만 제외
        context.beginPath();
        context.arc(mb.x, mb.y, mb.radius, 0, Math.PI * 2);
        context.fillStyle = '#ff00ff';
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = '#ffffff';
        context.stroke();
    });

    // 원래 공: mashBalls 활성 중엔 숨김, hold/mash는 위에서 이미 그림
    if (mashBalls.length === 0 && ball.type !== 'hold' && ball.type !== 'mash') {
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        context.fillStyle = ball.type === 'fake' ? '#b026ff' : (pendingSpecial && pendingSpecial.type === 'hold') ? '#ffff00' : '#00ffff';
        context.fill();
        if (ball.type === 'fake') {
            context.lineWidth = 2;
            context.strokeStyle = '#ffffff';
            context.stroke();
        }
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
    if (mashBalls.length > 0) return;

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
    if (isGameOver) return;
    originalRender();
    drawApproachCircle();
};

/* ========== GAME OVER ========== */
triggerGameOver = () => {
    isGameOver = true;

    keyLeft = false;
    keyRight = false;
    keyPaddleHeld = false;
    paddle.isPressed = false;

    let overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';

    let scoreStr = score.toString();
    while (scoreStr.length < 6) scoreStr = '0' + scoreStr;

    overlay.innerHTML = `
        <div class="go-title">GAME OVER</div>
        <div class="gc-diff-badge">${DIFFICULTY_LABEL[currentDifficulty] || ''}</div>
        <div class="go-label">FINAL SCORE</div>
        <div class="go-score">${scoreStr}</div>
        <button class="go-restart" onclick="restartGame()">다시하기</button>
        <button class="go-restart go-select" onclick="showDifficultySelect()">난이도 선택</button>
    `;

    playScreen.style.position = 'relative';
    playScreen.appendChild(overlay);
};

checkStageClear = () => {
    if (isGameOver) return;
    if (bricks.every(b => !b.alive)) triggerStageClear();
};

triggerStageClear = () => {
    isGameOver = true;

    keyLeft = false;
    keyRight = false;
    keyPaddleHeld = false;
    paddle.isPressed = false;

    let scoreStr = score.toString();
    while (scoreStr.length < 6) scoreStr = '0' + scoreStr;

    let currentIdx = DIFFICULTIES.indexOf(currentDifficulty);
    let hasNext = currentIdx < DIFFICULTIES.length - 1;
    let nextDiff = hasNext ? DIFFICULTIES[currentIdx + 1] : null;

    let overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.classList.add('stage-clear');

    let nextBtn = hasNext
        ? `<button class="go-restart go-next" onclick="startWithDifficulty('${nextDiff}')">다음 난이도: ${DIFFICULTY_LABEL[nextDiff]} ▶</button>`
        : `<div class="gc-all-clear">🎉 모든 난이도 클리어!</div>`;

    overlay.innerHTML = `
        <div class="gc-stars">★ ★ ★</div>
        <div class="gc-title">STAGE CLEAR</div>
        <div class="gc-diff-badge">${DIFFICULTY_LABEL[currentDifficulty]}</div>
        <div class="go-label">FINAL SCORE</div>
        <div class="go-score">${scoreStr}</div>
        ${nextBtn}
        <button class="go-restart" onclick="restartGame()">다시하기</button>
        <button class="go-restart go-select" onclick="showDifficultySelect()">난이도 선택</button>
    `;

    playScreen.style.position = 'relative';
    playScreen.appendChild(overlay);
};

restartGame = () => {
    startWithDifficulty(currentDifficulty);
};

window.startWithDifficulty = (diff) => {
    currentDifficulty = diff;

    // 오버레이 제거
    let overlay = document.getElementById('game-over-overlay');
    if (overlay) overlay.remove();
    let selectOverlay = document.getElementById('difficulty-select-overlay');
    if (selectOverlay) selectOverlay.remove();

    // 패들 너비 난이도 적용
    const cfg = DIFFICULTY_CONFIG[currentDifficulty] || DIFFICULTY_CONFIG.normal;
    paddle.width = cfg.paddleWidth;
    paddle.x = (500 - paddle.width) / 2;

    // 상태 전면 초기화
    score = 0;
    combo = 0;
    hp = 100;
    isGameOver = false;

    ball.x = 250; ball.y = 480;
    ball.speedX = 0; ball.speedY = 0;
    ball.type = 'normal'; ball.tailLength = 0;
    ball.specialLocked = false; ball.attached = true;
    ball.heldOnPaddle = false; ball.paddleOffsetX = 0;
    ball.earlyMissed = false;

    paddle.isPressed = false;

    effects = [];
    mashBalls = [];
    tailGrow = null;
    pendingSpecial = null;
    activeHoldTail = null;
    activeMashTail = null;

    uiUpdateHealth(hp);
    uiUpdateScoreAndCombo(score, combo);

    initTestBricks();
    render();
};

window.showDifficultySelect = () => {
    // 기존 오버레이 제거
    let existing = document.getElementById('game-over-overlay');
    if (existing) existing.remove();
    let existingSel = document.getElementById('difficulty-select-overlay');
    if (existingSel) existingSel.remove();

    isGameOver = true; // render 정지

    let overlay = document.createElement('div');
    overlay.id = 'difficulty-select-overlay';
    overlay.innerHTML = `
        <div class="ds-title">DIFFICULTY</div>
        <div class="ds-subtitle">난이도를 선택하세요</div>
        <div class="ds-buttons">
            <button class="ds-btn ds-easy" onclick="startWithDifficulty('easy')">
                <span class="ds-btn-label">쉬움</span>
                <span class="ds-btn-desc">EASY · 느린 공 · 넓은 패들</span>
            </button>
            <button class="ds-btn ds-normal" onclick="startWithDifficulty('normal')">
                <span class="ds-btn-label">보통</span>
                <span class="ds-btn-desc">NORMAL · 기본 속도</span>
            </button>
            <button class="ds-btn ds-hard" onclick="startWithDifficulty('hard')">
                <span class="ds-btn-label">어려움</span>
                <span class="ds-btn-desc">HARD · 빠른 공 · 좁은 패들</span>
            </button>
        </div>
    `;
    playScreen.style.position = 'relative';
    playScreen.appendChild(overlay);
};
