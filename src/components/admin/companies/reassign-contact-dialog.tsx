import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import {
  findCompanyForContact,
  lookupProfileByEmail,
  reassignCompanyContact,
} from "@/lib/company-contacts.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Candidate = {
  id: string;
  trade_name: string;
  legal_name: string | null;
  tax_id: string | null;
  city: string | null;
  state_code: string | null;
};

type Lookup =
  | { found: false }
  | {
      found: true;
      profile: {
        id: string;
        auth_user_id: string | null;
        full_name: string | null;
        email: string;
        company_id: string | null;
        pending_signup: boolean | null;
        is_active: boolean | null;
      };
      current_company: Candidate | null;
    };

export function ReassignContactDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const lookupFn = useServerFn(lookupProfileByEmail);
  const findFn = useServerFn(findCompanyForContact);
  const reassignFn = useServerFn(reassignCompanyContact);

  const [email, setEmail] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<Candidate | null>(null);

  const [reason, setReason] = useState("");
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setEmail("");
    setLookup(null);
    setQ("");
    setResults([]);
    setTarget(null);
    setReason("");
    setConfirmCheck(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const mapError = (msg: string): string => {
    switch (msg) {
      case "profile_not_found":
        return "Nenhum perfil encontrado com esse e-mail.";
      case "profile_not_active":
        return "Este perfil ainda não tem conta ativa. Use o fluxo 'Adicionar contato'.";
      case "target_company_not_found":
        return "Empresa de destino não encontrada.";
      case "already_in_target_company":
        return "O contato já pertence a esta empresa.";
      default:
        return msg;
    }
  };

  const doLookup = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    setLooking(true);
    try {
      const r = (await lookupFn({ data: { email: trimmed } })) as Lookup;
      setLookup(r);
      if (!r.found) {
        toast.warning("Nenhum perfil encontrado com esse e-mail.");
      } else if (!r.profile.auth_user_id) {
        toast.warning(
          "Este perfil é apenas pré-cadastro. Use 'Adicionar contato' para enviar convite.",
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLooking(false);
    }
  };

  const doSearch = async () => {
    if (q.trim().length < 1) return;
    setSearching(true);
    try {
      const r = await findFn({ data: { query: q.trim(), limit: 10 } });
      setResults((r.rows ?? []) as Candidate[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!lookup?.found || !lookup.profile.auth_user_id) return;
    if (!target) {
      toast.error("Selecione a empresa de destino.");
      return;
    }
    if (target.id === lookup.profile.company_id) {
      toast.error("O contato já pertence a esta empresa.");
      return;
    }
    if (reason.trim().length < 10) {
      toast.error("Informe um motivo (mínimo 10 caracteres).");
      return;
    }
    if (!confirmCheck) {
      toast.error("Confirme a operação marcando a caixa de confirmação.");
      return;
    }
    setSubmitting(true);
    try {
      await reassignFn({
        data: {
          email: email.trim(),
          target_company_id: target.id,
          reason: reason.trim(),
          confirm: true,
        },
      });
      toast.success("Contato reatribuído com sucesso.");
      reset();
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error(mapError((e as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !!lookup &&
    lookup.found &&
    !!lookup.profile.auth_user_id &&
    !!target &&
    target.id !== lookup.profile.company_id &&
    reason.trim().length >= 10 &&
    confirmCheck;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Reatribuir contato ativo</DialogTitle>
          <DialogDescription>
            Mova um contato com conta ativa para a empresa correta. O login do usuário é
            preservado e nenhuma nova empresa é criada. A ação fica registrada em auditoria.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>E-mail do contato</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setLookup(null);
                  setTarget(null);
                  setReason("");
                  setConfirmCheck(false);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doLookup(); } }}
                placeholder="contato@empresa.com"
              />
              <Button type="button" variant="outline" onClick={doLookup} disabled={looking}>
                {looking ? "..." : "Localizar"}
              </Button>
            </div>
          </div>

          {lookup && !lookup.found && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle size={14} /> Nenhum perfil encontrado.
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Use o fluxo "Adicionar contato" para criar um pré-cadastro e enviar convite.
              </p>
            </div>
          )}

          {lookup?.found && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="text-sm">
                <div className="font-medium">
                  {lookup.profile.full_name || lookup.profile.email}
                </div>
                <div className="text-xs text-muted-foreground">{lookup.profile.email}</div>
                {!lookup.profile.auth_user_id && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-amber-600">
                    <AlertTriangle size={12} /> Conta ainda não ativada (pré-cadastro).
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Empresa atual:</span>{" "}
                {lookup.current_company ? (
                  <>
                    {lookup.current_company.trade_name}
                    {lookup.current_company.tax_id ? ` · ${lookup.current_company.tax_id}` : ""}
                  </>
                ) : (
                  <em>nenhuma</em>
                )}
              </div>
            </div>
          )}

          {lookup?.found && lookup.profile.auth_user_id && (
            <>
              <div>
                <Label>Empresa de destino (CNPJ ou nome)</Label>
                <div className="mt-1.5 flex gap-2">
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
                    placeholder="COPASTUR ou 00.000.000/0000-00"
                  />
                  <Button type="button" variant="outline" onClick={doSearch} disabled={searching}>
                    <Search size={14} />
                  </Button>
                </div>
                {results.length > 0 && !target && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded-md border border-border p-2">
                    {results.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setTarget(r)}
                        className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <div className="font-medium">{r.trade_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.tax_id, r.city, r.state_code].filter(Boolean).join(" · ")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {target && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{lookup.current_company?.trade_name ?? "Sem empresa"}</span>
                    <ArrowRight size={12} />
                    <span className="font-medium text-foreground">{target.trade_name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[target.tax_id, target.city, target.state_code].filter(Boolean).join(" · ")}
                  </div>
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary underline"
                    onClick={() => setTarget(null)}
                  >
                    Trocar empresa
                  </button>
                </div>
              )}

              <div>
                <Label htmlFor="reassign-reason">Motivo da reatribuição *</Label>
                <Textarea
                  id="reassign-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="mt-1.5"
                  placeholder="Explique brevemente por que este contato precisa mudar de empresa."
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Mínimo 10 caracteres. Será registrado em auditoria.
                </p>
              </div>

              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={confirmCheck}
                  onChange={(e) => setConfirmCheck(e.target.checked)}
                />
                <span>
                  Confirmo que quero alterar a empresa deste contato. O login será preservado e
                  a alteração será auditada.
                </span>
              </label>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting ? "Reatribuindo..." : "Reatribuir contato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}