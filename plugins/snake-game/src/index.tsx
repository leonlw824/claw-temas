/**
 * 贪吃蛇游戏
 * 经典 Snake Game 实现
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// 游戏配置
const GRID_SIZE = 20;
const CELL_SIZE = 20;
const INITIAL_SPEED = 150;

// 方向
enum Direction {
  UP = 'UP',
  DOWN = 'DOWN',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
}

// 位置类型
interface Position {
  x: number;
  y: number;
}

export default function SnakeGame() {
  // 游戏状态
  const [snake, setSnake] = useState<Position[]>([{ x: 10, y: 10 }]);
  const [food, setFood] = useState<Position>({ x: 15, y: 15 });
  const [direction, setDirection] = useState<Direction>(Direction.RIGHT);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('snake-high-score') || '0');
    }
    return 0;
  });
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeed] = useState(INITIAL_SPEED);

  // 使用 ref 来存储方向，避免在事件监听中出现闭包问题
  const directionRef = useRef(direction);
  const gameOverRef = useRef(gameOver);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    gameOverRef.current = gameOver;
  }, [gameOver]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // 生成随机食物位置
  const generateFood = useCallback((currentSnake: Position[]) => {
    let newFood: Position;
    do {
      newFood = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (currentSnake.some(segment => segment.x === newFood.x && segment.y === newFood.y));
    return newFood;
  }, []);

  // 重置游戏
  const resetGame = useCallback(() => {
    const initialSnake = [{ x: 10, y: 10 }];
    setSnake(initialSnake);
    setFood(generateFood(initialSnake));
    setDirection(Direction.RIGHT);
    setGameOver(false);
    setScore(0);
    setSpeed(INITIAL_SPEED);
    setIsPaused(false);
  }, [generateFood]);

  // 游戏主循环
  useEffect(() => {
    const gameLoop = setInterval(() => {
      if (gameOverRef.current || isPausedRef.current) return;

      setSnake(currentSnake => {
        const newSnake = [...currentSnake];
        const head = { ...newSnake[0] };

        // 移动头部
        switch (directionRef.current) {
          case Direction.UP:
            head.y -= 1;
            break;
          case Direction.DOWN:
            head.y += 1;
            break;
          case Direction.LEFT:
            head.x -= 1;
            break;
          case Direction.RIGHT:
            head.x += 1;
            break;
        }

        // 检测撞墙
        if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
          setGameOver(true);
          return currentSnake;
        }

        // 检测撞到自己
        if (newSnake.some(segment => segment.x === head.x && segment.y === head.y)) {
          setGameOver(true);
          return currentSnake;
        }

        newSnake.unshift(head);

        // 检测是否吃到食物
        if (head.x === food.x && head.y === food.y) {
          setScore(s => {
            const newScore = s + 10;
            // 每50分加速一次
            if (newScore % 50 === 0) {
              setSpeed(sp => Math.max(50, sp - 10));
            }
            return newScore;
          });
          setFood(generateFood(newSnake));
        } else {
          // 没吃到食物，移除尾部
          newSnake.pop();
        }

        return newSnake;
      });
    }, speed);

    return () => clearInterval(gameLoop);
  }, [food, speed, generateFood]);

  // 更新最高分
  useEffect(() => {
    if (gameOver && score > highScore) {
      setHighScore(score);
      if (typeof window !== 'undefined') {
        localStorage.setItem('snake-high-score', score.toString());
      }
    }
  }, [gameOver, score, highScore]);

  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 防止方向键滚动页面
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      // 空格键暂停/继续
      if (e.key === ' ') {
        if (!gameOver) {
          setIsPaused(p => !p);
        }
        return;
      }

      // 游戏结束按回车重新开始
      if (e.key === 'Enter' && gameOver) {
        resetGame();
        return;
      }

      // 方向控制（防止180度转向）
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          if (directionRef.current !== Direction.DOWN) {
            setDirection(Direction.UP);
          }
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          if (directionRef.current !== Direction.UP) {
            setDirection(Direction.DOWN);
          }
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          if (directionRef.current !== Direction.RIGHT) {
            setDirection(Direction.LEFT);
          }
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          if (directionRef.current !== Direction.LEFT) {
            setDirection(Direction.RIGHT);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetGame, gameOver]);

  // 游戏区域样式
  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#fff',
  };

  const gameAreaStyle: React.CSSProperties = {
    position: 'relative',
    width: GRID_SIZE * CELL_SIZE,
    height: GRID_SIZE * CELL_SIZE,
    background: '#0f0f23',
    border: '3px solid #4a4a6a',
    borderRadius: '8px',
    boxShadow: '0 0 30px rgba(74, 74, 106, 0.5)',
  };

  const cellStyle = (isSnake: boolean, isFood: boolean, isHead: boolean): React.CSSProperties => ({
    position: 'absolute',
    width: CELL_SIZE - 1,
    height: CELL_SIZE - 1,
    left: 0,
    top: 0,
    transform: 'translate(0, 0)',
    backgroundColor: isFood
      ? '#ff6b6b'
      : isHead
      ? '#51cf66'
      : isSnake
      ? '#40c057'
      : 'transparent',
    borderRadius: isFood ? '50%' : '3px',
    boxShadow: isFood
      ? '0 0 10px #ff6b6b'
      : isHead
      ? '0 0 8px #51cf66'
      : undefined,
  });

  return (
    <div style={containerStyle}>
      {/* 标题 */}
      <h1 style={{ fontSize: '2.5rem', marginBottom: '10px', textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>
        🐍 贪吃蛇
      </h1>

      {/* 分数面板 */}
      <div style={{
        display: 'flex',
        gap: '30px',
        marginBottom: '20px',
        fontSize: '1.2rem',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#aaa', fontSize: '0.9rem' }}>当前分数</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#51cf66' }}>{score}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#aaa', fontSize: '0.9rem' }}>最高分</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#ffd43b' }}>{highScore}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#aaa', fontSize: '0.9rem' }}>速度</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#74c0fc' }}>
            {Math.round((INITIAL_SPEED - speed) / 10) + 1}
          </div>
        </div>
      </div>

      {/* 游戏区域 */}
      <div style={gameAreaStyle}>
        {/* 渲染蛇身 */}
        {snake.map((segment, index) => (
          <div
            key={index}
            style={{
              ...cellStyle(true, false, index === 0),
              transform: `translate(${segment.x * CELL_SIZE}px, ${segment.y * CELL_SIZE}px)`,
            }}
          />
        ))}

        {/* 渲染食物 */}
        <div
          style={{
            ...cellStyle(false, true, false),
            transform: `translate(${food.x * CELL_SIZE}px, ${food.y * CELL_SIZE}px)`,
          }}
        />

        {/* 游戏结束遮罩 */}
        {gameOver && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '5px',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '10px' }}>💀 游戏结束</div>
            <div style={{ fontSize: '1.2rem', marginBottom: '20px' }}>最终得分: {score}</div>
            {score > 0 && score === highScore && (
              <div style={{ color: '#ffd43b', marginBottom: '20px' }}>🎉 新纪录！</div>
            )}
            <button
              onClick={resetGame}
              style={{
                padding: '12px 30px',
                fontSize: '1.1rem',
                background: 'linear-gradient(135deg, #51cf66, #40c057)',
                color: '#fff',
                border: 'none',
                borderRadius: '25px',
                cursor: 'pointer',
                fontWeight: 'bold',
                boxShadow: '0 4px 15px rgba(81, 207, 102, 0.4)',
              }}
            >
              再玩一次 (Enter)
            </button>
          </div>
        )}

        {/* 暂停遮罩 */}
        {isPaused && !gameOver && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '5px',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '10px' }}>⏸️ 暂停</div>
            <div style={{ fontSize: '1rem', color: '#aaa' }}>按空格键继续</div>
          </div>
        )}
      </div>

      {/* 操作说明 */}
      <div style={{
        marginTop: '20px',
        textAlign: 'center',
        color: '#888',
        fontSize: '0.9rem',
      }}>
        <div style={{ marginBottom: '8px' }}>
          <span style={{ display: 'inline-block', margin: '0 8px' }}>⬆️ ⬇️ ⬅️ ➡️</span>
          <span>方向键或 WASD 移动</span>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <span style={{ display: 'inline-block', margin: '0 8px' }}>␣</span>
          <span>空格键暂停</span>
        </div>
        <div>
          <span style={{ display: 'inline-block', margin: '0 8px' }}>↵</span>
          <span>回车重新开始</span>
        </div>
      </div>

      {/* 开始游戏提示 */}
      {snake.length === 1 && score === 0 && !gameOver && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0,0,0,0.9)',
          padding: '30px 50px',
          borderRadius: '15px',
          textAlign: 'center',
          zIndex: 100,
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '15px' }}>🎮 准备好了吗？</div>
          <div style={{ color: '#aaa', marginBottom: '20px' }}>使用方向键控制蛇移动</div>
          <div style={{ fontSize: '0.9rem', color: '#666' }}>按任意方向键开始游戏</div>
        </div>
      )}
    </div>
  );
}
