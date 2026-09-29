package identityreconcile_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	adaptersqlite "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/adapters/sqlite/identitystore"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/application/identityreconcile"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/domain/identity"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/ports/identityinventory"
	ports "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/ports/identitystore"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
)

// The runtime generation stays the same during a Manager-mediated mutation.
// Its intent can be finalized and removed while a passive inventory is in flight.
func TestReconcileRejectsSnapshotOverlappingCompletedAPIKeyMutation(t *testing.T) {
	for _, kind := range []ports.APIKeyMutationKind{ports.APIKeyMutationRotate, ports.APIKeyMutationDelete} {
		t.Run(string(kind), func(t *testing.T) {
			ctx := context.Background()
			db, err := sqlite.Open(filepath.Join(t.TempDir(), "stale-snapshot.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })
			repo := adaptersqlite.New(db)
			oldHash, newHash := sha256Hex("old-key"), sha256Hex("new-key")
			if _, err := repo.ApplyPassiveSnapshot(ctx, ports.ReconcileSnapshotParams{
				RuntimeIdentity: "runtime-1", ObservedRuntimeGeneration: 10, NowMS: 1000,
				APIKeys: []ports.APIKeySnapshotItem{{APIKeyHash: oldHash}},
			}); err != nil {
				t.Fatal(err)
			}
			original, _, err := repo.FindActiveAPIKeyBySource(ctx, "runtime-1", oldHash)
			if err != nil {
				t.Fatal(err)
			}
			mutations := repo.(ports.MutationRepository)
			inventory := &fakeInventoryClient{
				apiKeys: []identityinventory.APIKeyObservation{{KeyHash: oldHash}},
				creds:   []identityinventory.CredentialObservation{{SourceAuthID: "unrelated-auth"}},
			}
			now := int64(2000)
			ready := func() (model.RuntimeObservedStatus, error) { return validReadyStatus(), nil }
			observer := &sequenceRuntimeObserver{statuses: []func() (model.RuntimeObservedStatus, error){
				ready,
				func() (model.RuntimeObservedStatus, error) {
					// Both inventory responses have been captured. Complete the explicit
					// mutation before ReconcileOnce commits the old snapshot.
					evidence := ports.APIKeyMutationEvidence{OldHash: oldHash, NormalizedOldCount: 1}
					var hashes []string
					if kind == ports.APIKeyMutationRotate {
						evidence.NewHash, evidence.ExactOldCount = newHash, 1
						hashes = []string{newHash}
					}
					id, err := mutations.PrepareAPIKeyMutation(ctx, ports.PrepareAPIKeyMutationParams{
						Kind: kind, RuntimeIdentity: "runtime-1", ObservedRuntimeGeneration: 10,
						Evidence: evidence, OwnerInstance: "process-A", NowMS: 2100,
					})
					if err != nil {
						t.Fatal(err)
					}
					if err := mutations.MarkAPIKeyMutationForwardComplete(ctx, id, "process-A", 2200); err != nil {
						t.Fatal(err)
					}
					outcome, err := mutations.ResolveAPIKeyMutation(ctx, ports.ResolveAPIKeyMutationParams{
						IntentID: id, RuntimeIdentity: "runtime-1", ObservedRuntimeGeneration: 10,
						ObservedHashes: hashes, NowMS: 2300,
					})
					if err != nil || outcome != ports.APIKeyMutationSuccess {
						t.Fatalf("finalize: %s %v", outcome, err)
					}
					if pending, err := mutations.HasPendingAPIKeyMutation(ctx, "runtime-1"); err != nil || pending {
						t.Fatalf("pending: %v %v", pending, err)
					}
					now = 2400
					return validReadyStatus(), nil
				}, ready, ready,
			}}
			svc, err := identityreconcile.NewService(identityreconcile.Config{
				RuntimeObserver: observer, InventoryClient: inventory, IdentityRepo: repo,
				ConnectionResolver: staticConnectionResolver("http://localhost:8317", "test-key"),
				ProcessInstanceID:  "process-A", TimeSource: func() int64 { now += 100; return now },
			})
			if err != nil {
				t.Fatal(err)
			}
			_, err = svc.ReconcileOnce(ctx)
			if !errors.Is(err, identityreconcile.ErrReconciliationConflict) || !errors.Is(err, ports.ErrStaleSnapshot) {
				t.Errorf("stale snapshot must be rejected, got %v", err)
			}
			if got, _, err := repo.FindActiveAPIKeyBySource(ctx, "runtime-1", oldHash); !errors.Is(err, ports.ErrNotFound) {
				t.Errorf("old source resurrected: %+v, %v", got, err)
			}
			got, err := repo.LoadAPIKeyByID(ctx, original.ID)
			wantLifecycle := identity.LifecycleActive
			inventory.apiKeys = nil
			if kind == ports.APIKeyMutationDelete {
				wantLifecycle = identity.LifecycleSuperseded
			} else {
				inventory.apiKeys = []identityinventory.APIKeyObservation{{KeyHash: newHash}}
			}
			if err != nil || got.Revision != original.Revision+1 || got.Lifecycle != wantLifecycle {
				t.Errorf("completed mutation overwritten: %+v, %v", got, err)
			}
			var credentialCount int
			if err := db.QueryRow(`select count(*) from gateway_credential_identities`).Scan(&credentialCount); err != nil || credentialCount != 0 {
				t.Errorf("rejected snapshot partially applied credentials: %d %v", credentialCount, err)
			}
			inventory.creds = nil
			// A fresh capture must recover normally, without an operator reset.
			if _, err := svc.ReconcileOnce(ctx); err != nil {
				t.Fatalf("fresh retry: %v", err)
			}
			if kind == ports.APIKeyMutationRotate {
				rotated, _, err := repo.FindActiveAPIKeyBySource(ctx, "runtime-1", newHash)
				if err != nil || rotated.ID != original.ID || rotated.Revision != original.Revision+1 || rotated.Lifecycle != identity.LifecycleActive {
					t.Errorf("fresh retry lost rotated identity: %+v %v", rotated, err)
				}
			}
		})
	}
}

func TestReconcileRejectsSnapshotOverlappingCompletedCredentialDelete(t *testing.T) {
	ctx := context.Background()
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "stale-credential.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := adaptersqlite.New(db)
	if _, err := repo.ApplyPassiveSnapshot(ctx, ports.ReconcileSnapshotParams{
		RuntimeIdentity: "runtime-1", ObservedRuntimeGeneration: 10, NowMS: 1000,
		Credentials: []ports.CredentialSnapshotItem{{SourceAuthID: "auth-1", PhysicalName: "account.json"}},
	}); err != nil {
		t.Fatal(err)
	}
	original, _, err := repo.FindActiveCredentialBySource(ctx, "runtime-1", "auth-1")
	if err != nil {
		t.Fatal(err)
	}
	mutations := repo.(ports.CredentialDeleteRepository)
	inventory := &fakeInventoryClient{creds: []identityinventory.CredentialObservation{{SourceAuthID: "auth-1", PhysicalName: "account.json"}}}
	now := int64(2000)
	ready := func() (model.RuntimeObservedStatus, error) { return validReadyStatus(), nil }
	observer := &sequenceRuntimeObserver{statuses: []func() (model.RuntimeObservedStatus, error){ready, ready, ready, ready}}
	inventory.fetchCreds = func(context.Context) ([]identityinventory.CredentialObservation, error) {
		// The delete completes while the inventory response is in flight.
		id, err := mutations.PrepareCredentialDelete(ctx, ports.PrepareCredentialDeleteParams{
			RuntimeIdentity: "runtime-1", ObservedRuntimeGeneration: 10, PhysicalName: "account.json",
			SourceAuthIDs: []string{"auth-1"}, OwnerInstance: "process-A", NowMS: 2100,
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := mutations.MarkCredentialDeleteForwardComplete(ctx, id, "process-A", 2200); err != nil {
			t.Fatal(err)
		}
		outcome, err := mutations.ResolveCredentialDelete(ctx, ports.ResolveCredentialDeleteParams{
			RuntimeIdentity: "runtime-1", ObservedRuntimeGeneration: 10, IntentID: id,
			NowMS: 2300, PhysicalEvidence: ports.PhysicalSourceAbsent,
		})
		if err != nil || outcome != ports.CredentialDeleteSuccess {
			t.Fatalf("finalize delete: %s %v", outcome, err)
		}
		now = 2400
		return inventory.creds, nil
	}
	svc, err := identityreconcile.NewService(identityreconcile.Config{
		RuntimeObserver: observer, InventoryClient: inventory, IdentityRepo: repo,
		ConnectionResolver: staticConnectionResolver("http://localhost:8317", "test-key"),
		ProcessInstanceID:  "process-A", TimeSource: func() int64 { now += 100; return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReconcileOnce(ctx); !errors.Is(err, ports.ErrStaleSnapshot) {
		t.Errorf("stale snapshot accepted: %v", err)
	}
	if got, _, err := repo.FindActiveCredentialBySource(ctx, "runtime-1", "auth-1"); !errors.Is(err, ports.ErrNotFound) {
		t.Errorf("deleted credential resurrected: %+v %v", got, err)
	}
	got, err := repo.LoadCredentialByID(ctx, original.ID)
	if err != nil || got.Lifecycle != identity.LifecycleSuperseded || got.Revision != original.Revision+1 {
		t.Errorf("deleted identity changed: %+v %v", got, err)
	}
	inventory.creds = nil
	inventory.fetchCreds = nil
	if _, err := svc.ReconcileOnce(ctx); err != nil {
		t.Fatalf("fresh retry: %v", err)
	}
}

type revisionReadFailureRepo struct {
	ports.Repository
	err error
}

func (r revisionReadFailureRepo) SourceBindingRevision(context.Context) (int64, error) {
	return 0, r.err
}

func TestReconcileRevisionReadFailureDoesNotCaptureOrApply(t *testing.T) {
	for _, failure := range []error{errors.New("revision unavailable"), context.Canceled} {
		t.Run(failure.Error(), func(t *testing.T) {
			repo := &recordingIdentityRepo{}
			inventory := &fakeInventoryClient{fetchAPIKeys: func(context.Context) ([]identityinventory.APIKeyObservation, error) {
				t.Fatal("inventory fetched without a binding revision")
				return nil, nil
			}}
			svc, err := identityreconcile.NewService(identityreconcile.Config{
				RuntimeObserver:    &dynamicRuntimeObserver{fn: func() (model.RuntimeObservedStatus, error) { return validReadyStatus(), nil }},
				ConnectionResolver: staticConnectionResolver("http://localhost:8317", "test-key"),
				InventoryClient:    inventory, IdentityRepo: revisionReadFailureRepo{Repository: repo, err: failure},
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.ReconcileOnce(context.Background()); !errors.Is(err, failure) {
				t.Fatalf("lost cause: %v", err)
			}
			if len(repo.applyCalls) != 0 {
				t.Fatal("applied snapshot after revision read failed")
			}
		})
	}
}
