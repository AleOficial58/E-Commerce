import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type ColorTheme = 'light' | 'dark'

type ThemeContextValue = {
  theme: ColorTheme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): ColorTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ColorTheme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#171419' : '#fff8f2',
    )
    try {
      window.localStorage.setItem('lumina:theme', theme)
    } catch (error) {
      console.warn('No se pudo guardar la preferencia de tema en este navegador.', error)
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => current === 'dark' ? 'light' : 'dark')
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme debe usarse dentro de ThemeProvider.')
  return context
}

export function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme()
  const label = theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'
  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      aria-label={label}
      title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
      onClick={toggleTheme}
    >
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {theme === 'dark'
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>
          : <path d="M20.8 14.2A8.7 8.7 0 0 1 9.8 3.2 8.8 8.8 0 1 0 20.8 14.2Z" />}
      </svg>
    </button>
  )
}
