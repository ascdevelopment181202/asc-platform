"use client";

import { useEffect } from "react";

/** Opens a conversation at the newest message, like a phone's messages app. */
export function ScrollToEnd() {
  useEffect(() => {
    document.getElementById("end")?.scrollIntoView({ block: "end" });
  }, []);
  return null;
}
