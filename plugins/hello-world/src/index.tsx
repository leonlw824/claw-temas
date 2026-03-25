/**
 * Hello World Extension App
 */
import { useState } from 'react';

export default function HelloWorldApp() {
  const [count, setCount] = useState(0);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom right, rgb(168, 85, 247), rgb(236, 72, 153), rgb(239, 68, 68))',
      padding: '2rem',
    }}>
      <div style={{
        maxWidth: '42rem',
        margin: '0 auto',
      }}>
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          borderRadius: '0.5rem',
          padding: '2rem',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ fontSize: '3.75rem', marginBottom: '1rem' }}>👋</div>
            <h1 style={{
              fontSize: '2.25rem',
              fontWeight: 'bold',
              color: 'rgb(31, 41, 55)',
              marginBottom: '1rem',
            }}>
              Hello World!
            </h1>
            <p style={{
              fontSize: '1.125rem',
              color: 'rgb(75, 85, 99)',
              marginBottom: '1.5rem',
            }}>
              欢迎来到 ClawX 扩展应用系统！这是一个独立编译和部署的扩展应用示例。
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}>
            <InfoCard label="应用 ID" value="hello-world" color="blue" />
            <InfoCard label="版本" value="1.0.0" color="green" />
            <InfoCard label="作者" value="ClawX Team" color="purple" />
            <InfoCard label="类型" value="扩展应用 (Plugin)" color="pink" />
          </div>

          <div style={{
            background: 'linear-gradient(to right, rgb(238, 242, 255), rgb(250, 245, 255))',
            borderRadius: '0.5rem',
            padding: '1.5rem',
            marginBottom: '1.5rem',
          }}>
            <h2 style={{
              fontSize: '1.25rem',
              fontWeight: '600',
              color: 'rgb(31, 41, 55)',
              marginBottom: '1rem',
            }}>
              交互演示
            </h2>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <p style={{ color: 'rgb(75, 85, 99)', marginBottom: '0.5rem' }}>点击次数:</p>
                <p style={{
                  fontSize: '2.25rem',
                  fontWeight: 'bold',
                  color: 'rgb(99, 102, 241)',
                }}>
                  {count}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setCount(count + 1)}
                  style={{
                    background: 'linear-gradient(to right, rgb(59, 130, 246), rgb(147, 51, 234))',
                    color: 'white',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.375rem',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                  }}
                >
                  增加
                </button>
                <button
                  onClick={() => setCount(0)}
                  style={{
                    backgroundColor: 'white',
                    color: 'rgb(31, 41, 55)',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.375rem',
                    border: '1px solid rgb(209, 213, 219)',
                    cursor: 'pointer',
                    fontWeight: '500',
                  }}
                >
                  重置
                </button>
              </div>
            </div>
          </div>

          <div style={{
            backgroundColor: 'rgb(254, 252, 232)',
            border: '1px solid rgb(254, 240, 138)',
            borderRadius: '0.5rem',
            padding: '1rem',
          }}>
            <p style={{ fontSize: '0.875rem', color: 'rgb(133, 77, 14)' }}>
              <strong>提示:</strong> 这是一个独立开发和编译的扩展应用，部署在 ~/.openclaw/apps 目录下。
              支持热加载，修改代码后重新编译即可生效。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors = {
    blue: { from: 'rgb(239, 246, 255)', to: 'rgb(219, 234, 254)' },
    green: { from: 'rgb(240, 253, 244)', to: 'rgb(220, 252, 231)' },
    purple: { from: 'rgb(250, 245, 255)', to: 'rgb(243, 232, 255)' },
    pink: { from: 'rgb(253, 242, 248)', to: 'rgb(252, 231, 243)' },
  };

  const gradient = colors[color as keyof typeof colors];

  return (
    <div style={{
      background: `linear-gradient(to bottom right, ${gradient.from}, ${gradient.to})`,
      borderRadius: '0.5rem',
      padding: '1rem',
    }}>
      <p style={{
        fontSize: '0.875rem',
        fontWeight: '600',
        color: 'rgb(75, 85, 99)',
        marginBottom: '0.25rem',
      }}>
        {label}
      </p>
      <p style={{
        color: 'rgb(31, 41, 55)',
        fontFamily: 'monospace',
        fontSize: '0.875rem',
      }}>
        {value}
      </p>
    </div>
  );
}
