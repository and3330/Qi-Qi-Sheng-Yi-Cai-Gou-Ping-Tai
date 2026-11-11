import * as React from "react"

const MOBILE_BREAKPOINT = 768

const readIsMobile = () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT

export function useIsMobile() {
  // 第一次畫面就用實際寬度判斷，手機上才不會先閃一下桌面版再切換
  const [isMobile, setIsMobile] = React.useState<boolean>(readIsMobile)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(readIsMobile())
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
