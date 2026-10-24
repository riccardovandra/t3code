import { isAdmin } from "../../shared/access.ts";
import { HUB_URL_META } from "../../shared/hub.ts";
import { isEmbedded } from "../embedBridge.ts";
import { useMe } from "../me.ts";
import { ArrowLeftIcon } from "./icons.tsx";

const hubUrl = document.querySelector(`meta[name="${HUB_URL_META}"]`)?.getAttribute("content");

/**
 * Back to the deployer's hub, when `HUB_URL` is set. Only the admin can enter
 * it, so shared-with people never see it; inside T3 Code (the Docs panel or
 * the mobile app) there is no hub to go back to.
 */
export function HubLink() {
  const me = useMe();
  if (!hubUrl || !me || !isAdmin(me.user.id) || isEmbedded()) return null;
  return (
    <a href={hubUrl} className="home-link hub-link" aria-label="Back to Hub">
      <ArrowLeftIcon size={14} />
      Hub
    </a>
  );
}
