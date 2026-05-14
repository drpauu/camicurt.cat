import { useMemo, useState } from "react";
import AulaBlocked from "../components/AulaBlocked.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import { submitAulaResult } from "../lib/aulaApi.js";

function loadParticipant(sessionId) {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`aula-participant:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toFixedLevelSnapshot(challenge) {
  if (!challenge) return null;
  return {
    id: challenge.id,
    mode: "aula",
    difficulty: challenge.difficultyId,
    difficultyId: challenge.difficultyId,
    startId: challenge.startId,
    targetId: challenge.targetId,
    rule: challenge.rule || null,
    avoidIds: challenge.avoidIds || [],
    mustPassIds: challenge.mustPassIds || [],
    shortestPath: challenge.shortestPath || [],
    shortestInternalCount: challenge.shortestInternalCount,
    studentPrompt: challenge.studentPrompt || ""
  };
}

export default function AulaPlayPage({ sessionId, PublicGameApp }) {
  const participant = useMemo(() => loadParticipant(sessionId), [sessionId]);
  const [submitState, setSubmitState] = useState("idle");
  const [message, setMessage] = useState("");
  const fixedLevelSnapshot = toFixedLevelSnapshot(participant?.challenge);

  async function handleComplete(result) {
    if (!participant || submitState === "sent" || submitState === "sending") return;
    setSubmitState("sending");
    setMessage("Enviant resultat...");
    try {
      const foundPath =
        Array.isArray(result.foundPathIds) && result.foundPathIds.length
          ? result.foundPathIds
          : [
              fixedLevelSnapshot.startId,
              ...(result.playerPath || []).map((entry) => entry.id).filter(Boolean),
              fixedLevelSnapshot.targetId
            ];
      await submitAulaResult({
        sessionId,
        participantId: participant.participantId,
        participantToken: participant.participantToken,
        completed: true,
        attempts: (result.playerPath || []).map((entry) => entry.id || entry.name).filter(Boolean),
        attemptsCount: result.attempts || 0,
        timeSeconds: Math.round((result.timeMs || 0) / 1000),
        precision: result.accuracy || null,
        optimalInternalCount: result.shortestCount || 0,
        foundInternalCount: result.foundCount || 0,
        distanceFromOptimal: result.distance || 0,
        foundPath,
        optimalPath: fixedLevelSnapshot.shortestPath,
        clientPayload: {
          difficulty: result.difficulty,
          ruleLabel: result.ruleLabel,
          displayName: participant.displayName
        }
      });
      setSubmitState("sent");
      setMessage("Resultat enviat al docent.");
    } catch (error) {
      setSubmitState("error");
      setMessage(error.message);
    }
  }

  if (!participant || !fixedLevelSnapshot) {
    return (
      <AulaLayout>
        <AulaBlocked message="Torna a entrar amb el codi de sessio per jugar aquest repte." />
      </AulaLayout>
    );
  }

  if (!PublicGameApp) {
    return (
      <AulaLayout>
        <AulaLoading label="Preparant el joc..." />
      </AulaLayout>
    );
  }

  return (
    <div className="aula-play">
      <div className="aula-play-bar">
        <strong>Camicurt Aula</strong>
        <span>{participant.displayName}</span>
        {message ? <span>{message}</span> : null}
        <a href="/aula/join">Sortir</a>
      </div>
      <PublicGameApp
        variant="aula"
        fixedLevelSnapshot={fixedLevelSnapshot}
        classroomSession={{ sessionId, participantId: participant.participantId }}
        onClassroomComplete={handleComplete}
        hidePublicChrome
        disableModeSwitch
        disableCalendar
        disableLocalRecords
      />
    </div>
  );
}
