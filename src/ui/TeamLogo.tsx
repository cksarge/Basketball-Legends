import { memo } from "react";
import type { Team } from "@/engine/types";
import { logoSvg } from "./logo";

export const TeamLogo = memo(function TeamLogo({ team, size = 48, className }: { team: Team; size?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{ display: "inline-block", width: size, height: size, flex: "none" }}
      role="img"
      aria-label={`${team.name} ${team.nickname} logo`}
      dangerouslySetInnerHTML={{ __html: logoSvg(team.logo, team.colors, { size }) }}
    />
  );
});
