package routes

import (
	"github.com/deployra/deployra/api/internal/config"
	"github.com/deployra/deployra/api/internal/handlers/account"
	"github.com/deployra/deployra/api/internal/handlers/apikeys"
	"github.com/deployra/deployra/api/internal/handlers/auth"
	"github.com/deployra/deployra/api/internal/handlers/callback"
	"github.com/deployra/deployra/api/internal/handlers/deployments"
	"github.com/deployra/deployra/api/internal/handlers/docker"
	githubHandlers "github.com/deployra/deployra/api/internal/handlers/github"
	"github.com/deployra/deployra/api/internal/handlers/gitproviders"
	"github.com/deployra/deployra/api/internal/handlers/instancetypegroups"
	"github.com/deployra/deployra/api/internal/handlers/instancetypes"
	"github.com/deployra/deployra/api/internal/handlers/organizations"
	"github.com/deployra/deployra/api/internal/handlers/projects"
	"github.com/deployra/deployra/api/internal/handlers/services"
	servicescreate "github.com/deployra/deployra/api/internal/handlers/services/create"
	servicecronjobs "github.com/deployra/deployra/api/internal/handlers/services/cronjobs"
	serviceenvvars "github.com/deployra/deployra/api/internal/handlers/services/envvars"
	singleservice "github.com/deployra/deployra/api/internal/handlers/services/service"
	servicestemplate "github.com/deployra/deployra/api/internal/handlers/services/template"
	"github.com/deployra/deployra/api/internal/handlers/servicetypes"
	"github.com/deployra/deployra/api/internal/handlers/templates"
	webhookcronjobs "github.com/deployra/deployra/api/internal/handlers/webhooks/cronjobs"
	webhookdeployments "github.com/deployra/deployra/api/internal/handlers/webhooks/deployments"
	webhookecr "github.com/deployra/deployra/api/internal/handlers/webhooks/ecr"
	webhookgithub "github.com/deployra/deployra/api/internal/handlers/webhooks/github"
	webhookmetrics "github.com/deployra/deployra/api/internal/handlers/webhooks/metrics"
	webhookservices "github.com/deployra/deployra/api/internal/handlers/webhooks/services"
	"github.com/deployra/deployra/api/internal/middleware"
	wshandler "github.com/deployra/deployra/api/internal/websocket"
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
)

func Setup(app *fiber.App, cfg *config.Config) {
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	api := app.Group("/api")

	// WebSocket
	api.Use("/socket", wshandler.UpgradeMiddleware)
	api.Get("/socket", websocket.New(wshandler.Handler))

	authPublic := api.Group("/auth")
	{
		// Auth - public
		authPublic.Post("/login", auth.Login)

		// Auth - protected (JWT)
		authPublic.Get("/user", middleware.AuthMiddleware(cfg), auth.GetUser)
	}

	// Callback (no auth)
	callbackRoutes := api.Group("/callback")
	{
		callbackRoutes.Get("/github", callback.GitHub)
	}

	// Templates (no auth)
	templatesRoutes := api.Group("/templates")
	{
		templatesRoutes.Get("/", templates.List)
		templatesRoutes.Get("/categories", templates.Categories)
		templatesRoutes.Get("/:slug", templates.Get)
		templatesRoutes.Post("/validate", templates.Validate)
	}

	// Webhooks - GitHub (no auth, signature verification)
	webhooksGithub := api.Group("/webhooks")
	{
		webhooksGithub.Post("/github", webhookgithub.Handle)
	}

	// Webhooks - protected (X-Api-Key)
	webhooksProtected := api.Group("/webhooks", middleware.WebhookApiKeyMiddleware(cfg))
	{
		webhooksProtected.Get("/ecr", webhookecr.Handle)
		webhooksProtected.Post("/deployments/:deploymentId/status", webhookdeployments.UpdateStatus)
		webhooksProtected.Post("/deployments/:deploymentId/logs", webhookdeployments.UpdateLogs)
		webhooksProtected.Post("/services/:serviceId/status", webhookservices.UpdateStatus)
		webhooksProtected.Post("/services/:serviceId/replicas", webhookservices.UpdateReplicas)
		webhooksProtected.Post("/services/:serviceId/pods", webhookservices.HandlePodEvent)
		webhooksProtected.Post("/service-metrics", webhookmetrics.HandleServiceMetrics)
		webhooksProtected.Post("/storage-metrics", webhookmetrics.HandleStorageMetrics)
		webhooksProtected.Get("/cronjob", webhookcronjobs.List)
		webhooksProtected.Post("/cronjob/:cronjobId/status", webhookcronjobs.UpdateStatus)
	}

	// Docker (JWT)
	dockerRoutes := api.Group("/docker-images", middleware.AuthMiddleware(cfg))
	{
		dockerRoutes.Post("/validate", docker.ValidateImage)
	}

	// Account (JWT)
	accountRoutes := api.Group("/account", middleware.AuthMiddleware(cfg))
	{
		accountRoutes.Patch("/password", account.UpdatePassword)
		accountRoutes.Patch("/profile", account.UpdateProfile)
	}

	// Organizations (JWT)
	orgs := api.Group("/organizations", middleware.AuthMiddleware(cfg))
	{
		orgs.Get("/", organizations.List)
		orgs.Post("/", organizations.Create)
		orgs.Get("/:organizationId", organizations.Get)
	}

	// Projects (JWT)
	projectsRoutes := api.Group("/projects", middleware.AuthMiddleware(cfg))
	{
		projectsRoutes.Get("/", projects.List)
		projectsRoutes.Post("/", projects.Create)
		projectsRoutes.Get("/:projectId", projects.Get)
		projectsRoutes.Post("/:projectId", projects.Update)
		projectsRoutes.Delete("/:projectId", projects.Delete)
	}

	// Services (JWT)
	servicesRoutes := api.Group("/services", middleware.AuthMiddleware(cfg))
	{
		servicesRoutes.Get("/", services.List)
		servicesRoutes.Post("/", servicescreate.Create)
		servicesRoutes.Post("/template", servicestemplate.Create)
		servicesRoutes.Get("/:serviceId", singleservice.Get)
		servicesRoutes.Patch("/:serviceId", singleservice.Update)
		servicesRoutes.Delete("/:serviceId", singleservice.Delete)
		servicesRoutes.Post("/:serviceId/deploy", singleservice.Deploy)
		servicesRoutes.Post("/:serviceId/restart", singleservice.Restart)
		servicesRoutes.Get("/:serviceId/deployments", singleservice.GetDeployments)
		servicesRoutes.Get("/:serviceId/events", singleservice.GetEvents)
		servicesRoutes.Get("/:serviceId/metrics", singleservice.GetMetrics)
		servicesRoutes.Get("/:serviceId/pods", singleservice.GetPods)
		servicesRoutes.Get("/:serviceId/environment-variables", serviceenvvars.List)
		servicesRoutes.Get("/:serviceId/environment-variables/:key", serviceenvvars.Get)
		servicesRoutes.Patch("/:serviceId/environment-variables/update", serviceenvvars.Update)
		servicesRoutes.Post("/:serviceId/environment-variables/delete", serviceenvvars.Delete)
		servicesRoutes.Get("/:serviceId/cronjobs", servicecronjobs.List)
		servicesRoutes.Post("/:serviceId/cronjobs", servicecronjobs.Create)
		servicesRoutes.Get("/:serviceId/cronjobs/:cronJobId", servicecronjobs.Get)
		servicesRoutes.Patch("/:serviceId/cronjobs/:cronJobId", servicecronjobs.Update)
		servicesRoutes.Delete("/:serviceId/cronjobs/:cronJobId", servicecronjobs.Delete)
	}

	// Deployments (JWT)
	deploymentsRoutes := api.Group("/deployments", middleware.AuthMiddleware(cfg))
	{
		deploymentsRoutes.Get("/:deploymentId", deployments.GetDeployment)
		deploymentsRoutes.Post("/:deploymentId/cancel", deployments.CancelDeployment)
		deploymentsRoutes.Get("/:deploymentId/logs", deployments.GetDeploymentLogs)
	}

	// Git Providers (JWT)
	gitProvidersRoutes := api.Group("/git-providers", middleware.AuthMiddleware(cfg))
	{
		gitProvidersRoutes.Get("/", gitproviders.ListProviders)
		gitProvidersRoutes.Post("/", gitproviders.CreateProvider)
		gitProvidersRoutes.Delete("/:providerId", gitproviders.DeleteProvider)
		gitProvidersRoutes.Get("/:providerId/repositories", gitproviders.ListRepositories)
		gitProvidersRoutes.Get("/:providerId/repositories/:repoFullName/branches", gitproviders.ListBranches)
		gitProvidersRoutes.Post("/:providerId/repositories/description", gitproviders.GetRepositoryDescription)
	}

	// API Keys (JWT)
	apiKeysRoutes := api.Group("/api-keys", middleware.AuthMiddleware(cfg))
	{
		apiKeysRoutes.Get("/", apikeys.List)
		apiKeysRoutes.Post("/", apikeys.Create)
		apiKeysRoutes.Get("/:apiKeyId", apikeys.Get)
		apiKeysRoutes.Delete("/:apiKeyId", apikeys.Delete)
	}

	// GitHub (JWT)
	githubRoutes := api.Group("/github", middleware.AuthMiddleware(cfg))
	{
		githubRoutes.Get("/accounts", githubHandlers.ListAccounts)
	}

	// Instance Type Groups (JWT)
	instanceTypeGroupsRoutes := api.Group("/instance-type-groups", middleware.AuthMiddleware(cfg))
	{
		instanceTypeGroupsRoutes.Get("/", instancetypegroups.List)
	}

	// Instance Types (JWT)
	instanceTypesRoutes := api.Group("/instance-types", middleware.AuthMiddleware(cfg))
	{
		instanceTypesRoutes.Get("/", instancetypes.List)
	}

	// Service Types (JWT)
	serviceTypesRoutes := api.Group("/service-types", middleware.AuthMiddleware(cfg))
	{
		serviceTypesRoutes.Get("/", servicetypes.List)
	}

}
