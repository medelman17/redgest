"use client";

import { useOptimistic, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatSubredditNames,
  type SerializedProfile,
  type SerializedSubreddit,
  type ProfileOptimisticAction,
} from "@/lib/types";
import { ProfileDialog } from "@/components/profile-dialog";
import { DeleteProfileDialog } from "@/components/delete-profile-dialog";

interface ProfileTableProps {
  profiles: SerializedProfile[];
  subreddits: SerializedSubreddit[];
}

function getDeliveryBadgeVariant(
  delivery: string,
): "default" | "secondary" | "outline" {
  switch (delivery) {
    case "EMAIL":
    case "SLACK":
    case "ALL":
      return "default";
    case "NONE":
    default:
      return "secondary";
  }
}

export function ProfileTable({ profiles, subreddits }: ProfileTableProps) {
  const [optimisticProfiles, dispatchOptimistic] = useOptimistic(
    profiles,
    (state: SerializedProfile[], action: ProfileOptimisticAction) => {
      switch (action.type) {
        case "add":
          return [...state, action.profile];
        case "remove":
          return state.filter((p) => p.profileId !== action.id);
        case "update":
          return state.map((p) =>
            p.profileId === action.id ? { ...p, ...action.changes } : p,
          );
      }
    },
  );

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<SerializedProfile | null>(
    null,
  );
  const [deleteProfile, setDeleteProfile] = useState<SerializedProfile | null>(
    null,
  );

  return (
    <>
      {optimisticProfiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <p className="text-sm text-muted-foreground">
            No profiles configured yet
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1.5 size-4" />
            Create your first profile
          </Button>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="mr-1.5 size-4" />
              Add Profile
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subreddits</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Max Posts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimisticProfiles.map((profile) => {
                const subNames = formatSubredditNames(profile.subredditList);
                return (
                <TableRow key={profile.profileId}>
                  <TableCell className="font-mono font-medium">
                    {profile.name}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {subNames !== "—" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block cursor-default truncate text-sm">
                            {subNames}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          className="max-w-sm whitespace-pre-wrap"
                        >
                          {subNames}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {profile.schedule ? (
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        {profile.schedule}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={getDeliveryBadgeVariant(profile.delivery)}
                      data-slot="badge"
                    >
                      {profile.delivery}
                    </Badge>
                  </TableCell>
                  <TableCell>{profile.maxPosts}</TableCell>
                  <TableCell>
                    <Badge
                      variant={profile.isActive ? "default" : "secondary"}
                      data-slot="badge"
                    >
                      {profile.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setEditProfile(profile)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Edit {profile.name}</span>
                      </Button>
                      {profile.name !== "Default" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteProfile(profile)}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Delete {profile.name}</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}

      {addDialogOpen && (
        <ProfileDialog
          mode="add"
          open={true}
          onOpenChange={(o) => {
            if (!o) setAddDialogOpen(false);
          }}
          onOptimistic={dispatchOptimistic}
          subreddits={subreddits}
        />
      )}

      {editProfile && (
        <ProfileDialog
          mode="edit"
          profile={editProfile}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditProfile(null);
          }}
          onOptimistic={dispatchOptimistic}
          subreddits={subreddits}
        />
      )}

      {deleteProfile && (
        <DeleteProfileDialog
          profile={deleteProfile}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteProfile(null);
          }}
          onOptimistic={dispatchOptimistic}
        />
      )}
    </>
  );
}
