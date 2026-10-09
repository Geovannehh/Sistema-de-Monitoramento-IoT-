import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { json } from "express";
import { FleetError } from "../../../shared/contracts";
import { FleetService } from "./fleet.service";
@Injectable()
class GatewayGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const header = context.switchToHttp().getRequest().headers.authorization;
    const value = Buffer.from(typeof header === "string" ? header : ""),
      expected = Buffer.from("Bearer " + process.env.API_TOKEN);
    if (value.length !== expected.length || !timingSafeEqual(value, expected))
      throw new UnauthorizedException("Acesso não autorizado.");
    return true;
  }
}
@Catch()
class BoundaryFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (error instanceof FleetError)
      return res.status(error.status).json({ error: error.message });
    if (error instanceof HttpException)
      return res.status(error.getStatus()).json({ error: error.message });
    console.error(
      "API boundary",
      error instanceof Error ? error.name : "unknown",
    );
    return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      error: "Não foi possível acessar a infraestrutura. Tente novamente.",
    });
  }
}
@Controller()
class HealthController {
  constructor(private readonly fleet: FleetService) {}
  @Get("health") async health() {
    return this.fleet.health();
  }
}
@Controller("fleet")
@UseGuards(GatewayGuard)
class FleetController {
  constructor(private readonly fleet: FleetService) {}
  @Get() async get() {
    return this.fleet.snapshot();
  }
  @Post() async post(@Body() body: unknown) {
    if (!body || typeof body !== "object" || !("action" in body))
      throw new FleetError("Operação inválida.");
    return this.fleet.action(body.action);
  }
}
@Module({
  controllers: [HealthController, FleetController],
  providers: [FleetService, GatewayGuard],
})
class AppModule {}
async function bootstrap() {
  const token = process.env.API_TOKEN || "";
  if (token.length < 32 || token.includes("replace"))
    throw new Error(
      "Configure API_TOKEN com 32 ou mais caracteres aleatórios.",
    );
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: "10kb" }));
  app.use(
    (
      _req: unknown,
      res: { setHeader: (k: string, v: string) => void },
      next: () => void,
    ) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      next();
    },
  );
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new BoundaryFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 8000), "0.0.0.0");
}
void bootstrap().catch(() => {
  console.error("Falha ao iniciar a API. Verifique variáveis e serviços.");
  process.exit(1);
});
