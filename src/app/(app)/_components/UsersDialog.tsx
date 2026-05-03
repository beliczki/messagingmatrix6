"use client";

import AppDialog from "./AppDialog";
import { UsersView } from "../users/UsersView";

type Props = {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
};

export default function UsersDialog({ open, onClose, currentUserId }: Props) {
  return (
    <AppDialog open={open} onClose={onClose} ariaLabel="Users">
      <div className="users-dialog flex h-full flex-col">
        <UsersView currentUserId={currentUserId} inDialog />
      </div>
    </AppDialog>
  );
}
