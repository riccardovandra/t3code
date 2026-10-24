import { isAdmin } from "../../shared/access.ts";
import { useMe } from "../me.ts";
import { ArrowLeftIcon } from "./icons.tsx";

const HUB_URL = "https://hub.upliftedconsulting.com";

/**
 * Back to the Uplifted Hub. Only the admin can enter the Hub, so shared-with
 * people never see it; inside T3 Code's Docs panel there is no Hub to go back to.
 */
export function HubLink() {
  const me = useMe();
  if (!me || !isAdmin(me.user.id) || window.parent !== window) return null;
  return (
    <a href={HUB_URL} className="home-link hub-link" aria-label="Back to Uplifted Hub">
      <ArrowLeftIcon size={14} />
      Hub
    </a>
  );
}
