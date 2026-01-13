import { Badge } from "~/components/ui/badge";

export type InvocationStatus = "running" | "success" | "failed" | "canceled";

const statusLabels: Record<InvocationStatus, string> = {
	running: "Running",
	success: "Success",
	failed: "Failed",
	canceled: "Canceled",
};

interface StatusBadgeProps {
	status: InvocationStatus;
}

export function StatusBadge(props: StatusBadgeProps) {
	return <Badge>{statusLabels[props.status]}</Badge>;
}
