/**
 * Admin dialog to create a new event without SQL.
 *
 * Persists to `events`, seeds `event_tables` (when tablesCount > 0), and
 * calls the canonical `rebuild_event_time_slots` RPC through
 * `createEventWithSetup`. On success invalidates the global event
 * selector query and switches the Admin context to the new event.
 *
 * Time-block modelling: Block 1 is required; Lunch and Block 2 are
 * explicit opt-in via Switches. Disabled blocks always submit `null` —
 * never an empty string or "00:00", both of which the DB rejects as
 * invalid TIMESTAMPTZ ("invalid input syntax for type timestamp with
 * time zone: 00:00:00").
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { createEventWithSetup } from "@/lib/admin.functions";
import { useAdminEvent } from "@/hooks/use-admin-event";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FormState = {
  name: string;
  eventDate: string;
  meetingsStart: string;
  meetingsEnd: string;
  useLunch: boolean;
  lunchStart: string;
  lunchEnd: string;
  useBlock2: boolean;
  meetings2Start: string;
  meetings2End: string;
  slotMinutes: number;
  tablesCount: number;
  languageDefault: "pt-BR" | "es";
};

const INITIAL: FormState = {
  name: "",
  eventDate: "",
  meetingsStart: "09:00",
  meetingsEnd: "12:00",
  useLunch: true,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  useBlock2: true,
  meetings2Start: "13:00",
  meetings2End: "17:00",
  slotMinutes: 20,
  tablesCount: 10,
  languageDefault: "pt-BR",
};

const isValidTime = (v: string) => /^\d{2}:\d{2}$/.test(v) && v !== "00:00";

export function NewEventDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { setEventId } = useAdminEvent();
  const createFn = useServerFn(createEventWithSetup);

  const validate = (): string | null => {
    if (!form.name.trim()) return "Informe o nome do evento";
    if (!form.eventDate) return "Informe a data do evento";
    if (!isValidTime(form.meetingsStart) || !isValidTime(form.meetingsEnd)) {
      return "Bloco 1: informe início e fim válidos";
    }
    if (form.meetingsEnd <= form.meetingsStart) {
      return "Bloco 1: fim deve ser após o início";
    }
    if (form.useLunch) {
      if (!isValidTime(form.lunchStart) || !isValidTime(form.lunchEnd)) {
        return "Almoço: informe início e fim válidos (ou desative o bloco)";
      }
      if (form.lunchEnd <= form.lunchStart) return "Almoço: fim deve ser após o início";
    }
    if (form.useBlock2) {
      if (!isValidTime(form.meetings2Start) || !isValidTime(form.meetings2End)) {
        return "Bloco 2: informe início e fim válidos (ou desative o bloco)";
      }
      if (form.meetings2End <= form.meetings2Start) {
        return "Bloco 2: fim deve ser após o início";
      }
    }
    return null;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      return createFn({
        data: {
          name: form.name,
          eventDate: form.eventDate,
          meetingsStart: form.meetingsStart,
          meetingsEnd: form.meetingsEnd,
          // Disabled blocks always go as null — the server composes
          // timestamps only for non-null pairs.
          lunchStart: form.useLunch ? form.lunchStart : null,
          lunchEnd: form.useLunch ? form.lunchEnd : null,
          meetings2Start: form.useBlock2 ? form.meetings2Start : null,
          meetings2End: form.useBlock2 ? form.meetings2End : null,
          slotMinutes: Number(form.slotMinutes),
          tablesCount: Number(form.tablesCount),
          languageDefault: form.languageDefault,
        },
      });
    },
    onSuccess: async (res) => {
      toast.success("Evento criado");
      await queryClient.invalidateQueries({ queryKey: ["admin-events-selector"] });
      if (res?.eventId) setEventId(res.eventId);
      setForm(INITIAL);
      setError(null);
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao criar evento");
    },
  });

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Novo evento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo evento</DialogTitle>
          <DialogDescription>
            Cria o evento, as mesas iniciais e gera os slots de reunião conforme os blocos ativos.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const err = validate();
            if (err) {
              setError(err);
              return;
            }
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="ev-name">Nome do evento</Label>
            <Input
              id="ev-name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
              minLength={2}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ev-date">Data</Label>
            <Input
              id="ev-date"
              type="date"
              value={form.eventDate}
              onChange={(e) => update("eventDate", e.target.value)}
              required
            />
          </div>

          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Bloco 1 de reuniões (obrigatório)</legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="m1s" className="text-xs">Início</Label>
                <Input id="m1s" type="time" value={form.meetingsStart}
                  onChange={(e) => update("meetingsStart", e.target.value)} required />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="m1e" className="text-xs">Fim</Label>
                <Input id="m1e" type="time" value={form.meetingsEnd}
                  onChange={(e) => update("meetingsEnd", e.target.value)} required />
              </div>
            </div>
          </fieldset>

          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <legend className="px-1 text-sm font-medium">Almoço / intervalo</legend>
              <div className="flex items-center gap-2">
                <Switch
                  id="use-lunch"
                  checked={form.useLunch}
                  onCheckedChange={(v) => update("useLunch", v)}
                />
                <Label htmlFor="use-lunch" className="text-xs text-muted-foreground">
                  {form.useLunch ? "Ativado" : "Sem almoço"}
                </Label>
              </div>
            </div>
            {form.useLunch ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="ls" className="text-xs">Início</Label>
                  <Input id="ls" type="time" value={form.lunchStart}
                    onChange={(e) => update("lunchStart", e.target.value)} required />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="le" className="text-xs">Fim</Label>
                  <Input id="le" type="time" value={form.lunchEnd}
                    onChange={(e) => update("lunchEnd", e.target.value)} required />
                </div>
              </div>
            ) : null}
          </fieldset>

          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <legend className="px-1 text-sm font-medium">Bloco 2 de reuniões</legend>
              <div className="flex items-center gap-2">
                <Switch
                  id="use-block2"
                  checked={form.useBlock2}
                  onCheckedChange={(v) => update("useBlock2", v)}
                />
                <Label htmlFor="use-block2" className="text-xs text-muted-foreground">
                  {form.useBlock2 ? "Ativado" : "Sem Bloco 2"}
                </Label>
              </div>
            </div>
            {form.useBlock2 ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="m2s" className="text-xs">Início</Label>
                  <Input id="m2s" type="time" value={form.meetings2Start}
                    onChange={(e) => update("meetings2Start", e.target.value)} required />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="m2e" className="text-xs">Fim</Label>
                  <Input id="m2e" type="time" value={form.meetings2End}
                    onChange={(e) => update("meetings2End", e.target.value)} required />
                </div>
              </div>
            ) : null}
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="slot" className="text-xs">Duração do slot (min)</Label>
              <Input id="slot" type="number" min={5} max={120}
                value={form.slotMinutes}
                onChange={(e) => update("slotMinutes", Number(e.target.value))} required />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tables" className="text-xs">Mesas</Label>
              <Input id="tables" type="number" min={0} max={500}
                value={form.tablesCount}
                onChange={(e) => update("tablesCount", Number(e.target.value))} required />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Idioma padrão</Label>
            <Select
              value={form.languageDefault}
              onValueChange={(v) => update("languageDefault", v as FormState["languageDefault"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Criando…" : "Criar evento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}