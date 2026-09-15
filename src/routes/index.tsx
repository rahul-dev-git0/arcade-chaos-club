import { createFileRoute } from "@tanstack/react-router";
import { FaceOffApp } from "@/components/FaceOffApp";

export const Route = createFileRoute("/")({
  component: FaceOffApp,
});
