// ========================
// 기본 캔버스/컨텍스트
// ========================
let canvas, ctx;

// ========================
// 전역: 객체 상태
// ========================
let ball;
let paddle;
let bricks = [];
let effects = [];

// 연타용 더미(허상 공)
let dummyBalls = [];   // [{delay, x, y}...]

// 게임 상태
let gameRunning = false;
let ballLaunched = false;

// 입력 상태
let keyLeft = false;
let keyRight = false;
let keyPaddleHeld = false;

// ========================
// 판정/물리 관련 기본 상수
// ========================
const JUDGE_LINE_Y = 520;
const PERFECT_WINDOW = 16;
const GOOD_WINDOW = 32;
const EARLY_LATE_WINDOW = 48;

let BALL_INIT_SPEED = 5;
let ballSpeedX = 0;
let ballSpeedY = 0;

// ========================
// 롱노트/연타 관련 상태
// ========================

// 롱노트 상태
let holdActive = false;
let activeLongNote = null; 
// activeLongNote = { frames, targetFrames, initialJudgement }

// 공 궤적 기록 (롱노트 tail + 연타 허상 공 추적용)
let ballPathQueue = []; // [{x,y}]
let ballHistory = [];   // [{x,y}]

/* -------------------------------------------------
   초기화: 테스트 환경용 기본 세팅
   (팀 프로젝트에서는 DOMContentLoaded 안에서 호출)
   ------------------------------------------------- */
function initNoteTest(canvasId = 'noteCanvas') {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error('canvas not found');
        return;
    }
    ctx = canvas.getContext('2d');

    // 패들
    paddle = {
        x: (canvas.width - 140) / 2,
        y: JUDGE_LINE_Y,
        width: 140,
        height: 12,
        isPressed: false
    };

    // 공
    ball = {
        x: paddle.x + paddle.width / 2,
        y: paddle.y - 16,
        radius: 8,
        type: 'normal',     // 'normal' | 'hold' | 'mash'
        isHidden: false
    };

    ballSpeedX = 0;
    ballSpeedY = 0;
    ballLaunched = false;

    // 벽돌 (테스트용: normal, hold, mash 섞어서)
    createTestBricks();

    // 입력 바인딩
    bindNoteInput();

    gameRunning = true;
    requestAnimationFrame(renderNoteTest);
}

// 테스트용 브릭 배치
function createTestBricks() {
    bricks = [];
    const rows = 3;
    const cols = 6;
    const brickWidth = 60;
    const brickHeight = 18;
    const offsetX = 40;
    const offsetY = 80;
    const gap = 10;

    let idCounter = 1;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let type = 'normal';
            if (r === 0 && (c === 1 || c === 4)) type = 'hold';
            if (r === 1 && (c === 0 || c === 5)) type = 'mash';

            bricks.push({
                id: idCounter++,
                x: offsetX + c * (brickWidth + gap),
                y: offsetY + r * (brickHeight + gap),
                width: brickWidth,
                height: brickHeight,
                alive: true,
                noteType: type
            });
        }
    }
}

/* -------------------------------------------------
   입력: 좌우 이동 + ArrowUp 발사/판정
   ------------------------------------------------- */
function bindNoteInput() {
    window.addEventListener('keydown', (e) => {
        if (!gameRunning) return;
        if (e.code === 'ArrowLeft') keyLeft = true;
        if (e.code === 'ArrowRight') keyRight = true;
        if (e.code === 'ArrowUp') {
            if (!ballLaunched) launchNoteBall();
            handleNotePaddlePress();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (!gameRunning) return;
        if (e.code === 'ArrowLeft') keyLeft = false;
        if (e.code === 'ArrowRight') keyRight = false;
        if (e.code === 'ArrowUp') handleNotePaddleRelease();
    });
}

/* -------------------------------------------------
   공 발사 / 패들 입력
   ------------------------------------------------- */
function launchNoteBall() {
    if (ballLaunched) return;
    ballLaunched = true;

    let angle = -Math.PI / 4 - Math.random() * (Math.PI / 4);
    ballSpeedX = BALL_INIT_SPEED * Math.cos(angle);
    ballSpeedY = BALL_INIT_SPEED * Math.sin(angle);
}

function handleNotePaddlePress() {
    paddle.isPressed = true;
    keyPaddleHeld = true;

    if (!ballLaunched) return;
    tryNoteBumperJudge();
}

function handleNotePaddleRelease() {
    paddle.isPressed = false;
    keyPaddleHeld = false;

    // 롱노트 release 판정
    if (activeLongNote) {
        let diff = Math.abs(activeLongNote.frames - activeLongNote.targetFrames);
        let result;
        if (diff <= 15 && activeLongNote.initialJudgement === 'perfect') {
            result = 'perfect';
        } else if (diff <= 30) {
            result = 'good';
        } else {
            result = 'miss';
        }

        console.log('Long note release:', result);

        // 롱노트 종료
        ball.isHidden = false;
        ball.type = 'normal';
        activeLongNote = null;
        holdActive = false;

        // 공 반사 (기본 반사)
        reflectNoteBall();
    }
}

/* -------------------------------------------------
   메인 업데이트
   ------------------------------------------------- */
function updateNote(dt) {
    if (!gameRunning) return;

    // 패들 이동
    const moveSpeed = 350;
    if (keyLeft) paddle.x -= moveSpeed * dt;
    if (keyRight) paddle.x += moveSpeed * dt;
    if (paddle.x < 0) paddle.x = 0;
    if (paddle.x + paddle.width > canvas.width) paddle.x = canvas.width - paddle.width;

    // 공 이동
    if (!ballLaunched) {
        ball.x = paddle.x + paddle.width / 2;
        ball.y = paddle.y - 16;
    } else if (!ball.isHidden) {
        ball.x += ballSpeedX;
        ball.y += ballSpeedY;

        // 벽 충돌
        if (ball.x - ball.radius < 0) { ball.x = ball.radius; ballSpeedX *= -1; }
        else if (ball.x + ball.radius > canvas.width) { ball.x = canvas.width - ball.radius; ballSpeedX *= -1; }
        if (ball.y - ball.radius < 0) { ball.y = ball.radius; ballSpeedY *= -1; }

        // 패들 물리 충돌 (판정 실패 시 최소한 튕겨나가기)
        if (ballSpeedY > 0 &&
            ball.y + ball.radius >= paddle.y - paddle.height / 2 &&
            ball.y - ball.radius <= paddle.y + paddle.height / 2 &&
            ball.x >= paddle.x &&
            ball.x <= paddle.x + paddle.width) {

            // hold 상태인데 holdActive가 아니면 miss로 처리 후 반사
            if (ball.type === 'hold' && !holdActive) {
                console.log('Long note miss by body collision');
                ball.type = 'normal';
            }
            reflectNoteBall();
        }

        // pathQueue / history 갱신
        ballPathQueue.push({ x: ball.x, y: ball.y });
        if (ballPathQueue.length > 200) ballPathQueue.shift();

        ballHistory.push({ x: ball.x, y: ball.y });
        if (ballHistory.length > 15) ballHistory.shift();

        // 브릭 충돌
        updateNoteBrickCollision();
    }

    // 연타 dummy 공 추적
    for (let i = dummyBalls.length - 1; i >= 0; i--) {
        let d = dummyBalls[i];
        let targetIdx = ballPathQueue.length - 1 - d.delay;
        if (targetIdx >= 0 && targetIdx < ballPathQueue.length) {
            d.x = ballPathQueue[targetIdx].x;
            d.y = ballPathQueue[targetIdx].y;
            if (d.y > canvas.height) {
                console.log('Mash dummy miss (fell)');
                dummyBalls.splice(i, 1);
            }
        }
    }

    // 공 바닥 miss
    if (ballLaunched && ball.y - ball.radius > canvas.height && !ball.isHidden) {
        console.log('Main ball miss (fell)');
        ballLaunched = false;
        ballSpeedX = 0;
        ballSpeedY = 0;
        ball.type = 'normal';
        ballHistory = [];
        ballPathQueue = [];
        dummyBalls = [];
        activeLongNote = null;
    }

    // 롱노트 유지 중
    if (activeLongNote) {
        activeLongNote.frames++;
        // 너무 오래 누르고 있으면 자동 미스
        if (activeLongNote.frames > activeLongNote.targetFrames + 30) {
            console.log('Long note auto miss (too long)');
            ball.isHidden = false;
            ball.type = 'normal';
            activeLongNote = null;
            holdActive = false;
            reflectNoteBall();
        }
    }
}

/* -------------------------------------------------
   벽돌 충돌
   ------------------------------------------------- */
function updateNoteBrickCollision() {
    for (let b of bricks) {
        if (!b.alive) continue;

        if (ball.x + ball.radius > b.x &&
            ball.x - ball.radius < b.x + b.width &&
            ball.y + ball.radius > b.y &&
            ball.y - ball.radius < b.y + b.height) {

            b.alive = false;
            ballSpeedY *= -1;

            // 노트 타입 부여
            ball.type = b.noteType;

            if (b.noteType === 'mash') {
                // 연타 허상 공 2개
                dummyBalls.push({ delay: 15, x: ball.x, y: ball.y });
                dummyBalls.push({ delay: 30, x: ball.x, y: ball.y });
                console.log('Mash note spawned');
            } else if (b.noteType === 'hold') {
                console.log('Hold note spawned');
            } else {
                console.log('Normal note brick');
            }

            break;
        }
    }
}

/* -------------------------------------------------
   판정 시스템 (ArrowUp 누를 때)
   ------------------------------------------------- */
function tryNoteBumperJudge() {
    const checkHit = (targetY) => {
        const dy = targetY - JUDGE_LINE_Y;
        const absDy = Math.abs(dy);
        if (absDy > EARLY_LATE_WINDOW) return null;
        if (absDy <= PERFECT_WINDOW) return 'perfect';
        if (absDy <= GOOD_WINDOW) return 'good';
        return 'late';
    };

    // 1. 연타 dummy 공 판정
    for (let i = dummyBalls.length - 1; i >= 0; i--) {
        let d = dummyBalls[i];
        let judge = checkHit(d.y);
        if (judge) {
            console.log('Mash dummy hit:', judge);
            dummyBalls.splice(i, 1);
            return; // 한 번 입력에 하나만 처리
        }
    }

    // 2. 메인 공 판정
    if (!ball.isHidden && ballSpeedY > 0) {
        let judge = checkHit(ball.y);
        if (judge) {
            if (ball.type === 'hold') {
                // 롱노트 시작
                activeLongNote = {
                    frames: 0,
                    targetFrames: 60,
                    initialJudgement: judge
                };
                holdActive = true;
                console.log('Long note start:', judge);
                reflectNoteBall();
            } else {
                console.log('Normal/mash main hit:', judge);
                reflectNoteBall();
            }
        }
    }
}

/* -------------------------------------------------
   공 반사
   ------------------------------------------------- */
function reflectNoteBall() {
    const speed = Math.sqrt(ballSpeedX * ballSpeedX + ballSpeedY * ballSpeedY) || BALL_INIT_SPEED;
    let hitPoint = (ball.x - paddle.x) / (paddle.width / 2);
    hitPoint = Math.max(-0.85, Math.min(0.85, hitPoint)); 
    let angle = hitPoint * (Math.PI / 2.5) - Math.PI / 2; 
    
    ballSpeedX = Math.cos(angle) * speed;
    ballSpeedY = Math.sin(angle) * speed;
}

/* -------------------------------------------------
   렌더링
   ------------------------------------------------- */
function drawNoteBricks() {
    bricks.forEach(b => {
        if (!b.alive) return;
        ctx.fillStyle = b.noteType === 'normal'
            ? '#00aaaa'
            : b.noteType === 'hold'
            ? '#ffaa00'
            : '#ff00ff';
        ctx.fillRect(b.x, b.y, b.width, b.height);
    });
}

function drawNotePaddle() {
    // PERFECT 범위 박스
    ctx.fillStyle = 'rgba(0, 255, 255, 0.08)';
    ctx.fillRect(0, JUDGE_LINE_Y - PERFECT_WINDOW, canvas.width, PERFECT_WINDOW * 2);

    // 판정선
    ctx.beginPath();
    ctx.moveTo(0, paddle.y);
    ctx.lineTo(canvas.width, paddle.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
    ctx.stroke();

    // 패들 본체
    ctx.fillStyle = paddle.isPressed ? '#ffffff' : '#000000';
    ctx.fillRect(paddle.x, paddle.y - (paddle.height / 2), paddle.width, paddle.height);
    ctx.strokeStyle = paddle.isPressed ? '#00ffff' : '#ffffff';
    ctx.strokeRect(paddle.x, paddle.y - (paddle.height / 2), paddle.width, paddle.height);

    // 롱노트 링 이펙트
    if (activeLongNote) {
        let ratio = activeLongNote.frames / activeLongNote.targetFrames;
        ctx.beginPath();
        ctx.arc(paddle.x + paddle.width / 2, paddle.y, 15 + (ratio * 30), 0, Math.PI * 2);
        ctx.strokeStyle = (ratio > 0.85 && ratio < 1.15) ? '#00ffff' : '#ffaa00';
        ctx.lineWidth = 4;
        ctx.stroke();
    }
}

function drawNoteBallAndTails() {
    // 연타 dummy
    dummyBalls.forEach(d => {
        ctx.beginPath();
        ctx.arc(d.x, d.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ff00ff';
        ctx.fill();
    });

    // 메인 공 tail
    if (!ball.isHidden && ballHistory.length > 0) {
        ctx.beginPath();
        ctx.moveTo(ballHistory[0].x, ballHistory[0].y);
        for (let i = 1; i < ballHistory.length; i++) {
            ctx.lineTo(ballHistory[i].x, ballHistory[i].y);
        }
        ctx.lineWidth = ball.radius * 1.5;
        ctx.lineCap = 'round';

        if (ball.type === 'hold') ctx.strokeStyle = 'rgba(255, 170, 0, 0.5)';
        else if (ball.type === 'mash') ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)';
        else ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';

        ctx.stroke();
    }

    // 메인 공 본체
    if (!ball.isHidden) {
        let mainBallColor = '#00ffff';
        if (ball.type === 'hold') mainBallColor = '#ffaa00';
        else if (ball.type === 'mash') mainBallColor = '#ff00ff';

        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = mainBallColor;
        ctx.fill();
    }
}

function drawNoteEffects() {
    effects = effects.filter(ef => { ef.radius += 2; ef.alpha -= 0.05; return ef.alpha > 0; });
    effects.forEach(ef => {
        ctx.beginPath();
        ctx.arc(ef.x, ef.y, ef.radius, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(255, 255, 255, ${ef.alpha})`;
        ctx.stroke();
    });
}

/* -------------------------------------------------
   렌더 루프
   ------------------------------------------------- */
let prevNoteTime = performance.now();
function renderNoteTest(now) {
    if (!now) now = performance.now();
    const dt = (now - prevNoteTime) / 1000;
    prevNoteTime = now;

    if (gameRunning) updateNote(dt);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawNoteBricks();
    drawNotePaddle();
    drawNoteBallAndTails();
    drawNoteEffects();

    requestAnimationFrame(renderNoteTest);
}
