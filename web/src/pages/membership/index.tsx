import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { openAiMembershipModal } from "@/components/layout/ai-membership-modal";

export default function MembershipPage() {
    const navigate = useNavigate();

    useEffect(() => {
        const timer = window.setTimeout(() => {
            openAiMembershipModal();
            navigate("/", { replace: true });
        });
        return () => window.clearTimeout(timer);
    }, [navigate]);

    return null;
}
